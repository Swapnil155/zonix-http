// npm pack smoke: build the tarball exactly as npm would publish it, install it
// into an empty temp project, run examples/basic.ts against the INSTALLED
// package (only its import line rewritten to the package name) and probe the
// routes. Proves the exports map, the types entry, `files`, and that nothing
// in dist/ reaches back into lib/ or node_modules at runtime.
//
//   npm run pack:smoke
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// npm is a .cmd shim on Windows, which Node refuses to spawn without a shell.
const win = process.platform === "win32";
const npm = win ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], shell: win, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
  return r.stdout.toString();
}

const work = mkdtempSync(join(tmpdir(), "zonix-pack-"));
try {
  // 1. pack
  // `prepack` runs the build, whose CLI output shares stdout with --json: the
  // report is the last top-level JSON array in the stream.
  const packOut = run(npm, ["pack", "--json", "--pack-destination", work], { cwd: root });
  const packed = JSON.parse(packOut.slice(packOut.lastIndexOf("\n[") + 1));
  const tarball = join(work, packed[0].filename);
  const files = packed[0].files.map((f) => f.path);
  console.log(`packed ${packed[0].filename}: ${files.length} files, ${packed[0].size} bytes`);
  for (const f of files) {
    if (!f.startsWith("dist/") && f !== "package.json" && f !== "README.md" && f !== "LICENSE") {
      throw new Error(`unexpected file in tarball: ${f}`);
    }
  }
  for (const must of ["dist/index.js", "dist/index.d.ts", "dist/index.js.map"]) {
    if (!files.includes(must)) throw new Error(`tarball is missing ${must}`);
  }

  // 2. install into an empty project
  const app = join(work, "app");
  cpSync(join(root, "examples", "public"), join(app, "public"), { recursive: true }); // creates app/
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({ name: "smoke", private: true, type: "module" }),
  );
  run(npm, ["install", "--no-audit", "--no-fund", "--silent", tarball], { cwd: app });

  // 3. examples/basic.ts with its import line pointed at the installed package
  const src = readFileSync(join(root, "examples", "basic.ts"), "utf8").replaceAll(
    'from "../lib/index.js"',
    `from "${pkg.name}"`,
  );
  if (src.includes("../lib/")) throw new Error("example still imports ../lib");
  writeFileSync(join(app, "basic.ts"), src);

  // 4. run it with the repo's tsx (dev tooling), the package resolved from app/node_modules
  const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const port = 3000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [tsx, join(app, "basic.ts")], {
    cwd: app,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server never listened:\n${log}`)), 20000);
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/health`);
          if (r.ok) {
            clearInterval(poll);
            clearTimeout(t);
            resolve();
          }
        } catch {
          /* not yet */
        }
      }, 150);
    });

    const probes = [
      ["GET", "/health", 200, /"status":"ok"/],
      ["GET", "/users/42?verbose=1", 200, /"id":"42".*"verbose":"1"/],
      ["POST", "/users", 201, /"created":\{"name":"ada"\}/, '{"name":"ada"}'],
      ["DELETE", "/users/7", 401, /X-API-Key/],
      ["GET", "/files/index.html", 200, /html/],
      ["GET", "/index.html", 200, /html/],
      ["GET", "/boom", 500, /Something went wrong/],
      ["GET", "/nope", 404, /No route/],
    ];
    for (const [method, path, status, pattern, body] of probes) {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        body,
        headers: body ? { "content-type": "application/json" } : {},
        redirect: "manual",
      });
      const text = await r.text();
      if (r.status !== status || !pattern.test(text)) {
        throw new Error(`${method} ${path}: got ${r.status} ${text.slice(0, 120)}`);
      }
      console.log(`ok ${method} ${path} -> ${r.status}`);
    }
  } finally {
    // Wait for the process to be gone: Windows keeps the directory busy until then.
    await new Promise((r) => {
      child.once("exit", r);
      child.kill();
    });
  }
  console.log(`PACK SMOKE OK: ${pkg.name}@${pkg.version} installs and serves examples/basic`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
