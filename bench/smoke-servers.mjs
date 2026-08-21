// Smoke-check every bench server against every scenario path BEFORE benching:
// status, content-type, content-length and body bytes must agree across
// frameworks, or the benchmark would be measuring different work.
//
//   node bench/smoke-servers.mjs                      # zonix express fastify cpeak
//   node bench/smoke-servers.mjs --frameworks=zonix,cpeak
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ECHO_BODY_JSON } from "./servers/shared.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const FRAMEWORKS = (args.get("frameworks") ?? "zonix,express,fastify,cpeak").split(",");

const PROBES = [
  { id: "hello", path: "/" },
  { id: "param", path: "/users/42" },
  { id: "routes-200-param", path: "/api/v1/res120/12345", env: { BENCH_ROUTES: "200" } },
  { id: "chain", path: "/chain" },
  { id: "404", path: "/no-such-route", expect: 404, bodyMayDiffer: true },
  {
    id: "post-json-echo",
    path: "/echo",
    method: "POST",
    body: ECHO_BODY_JSON,
    headers: { "content-type": "application/json" },
  },
  { id: "file-1kb", path: "/file/small" },
  { id: "file-1mb", path: "/file/large" },
];

let nextPort = 3700;
function start(framework, env) {
  return new Promise((resolve, reject) => {
    const port = nextPort++;
    const child = spawn(process.execPath, [`bench/servers/${framework}.js`], {
      cwd: root,
      env: { ...process.env, PORT: String(port), ...env },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const timer = setTimeout(() => reject(new Error(`${framework} never signalled ready`)), 20000);
    child.once("message", (m) => {
      if (m === "ready") {
        clearTimeout(timer);
        resolve({ child, port });
      }
    });
    child.once("error", reject);
  });
}
const stop = (child) =>
  new Promise((resolve) => {
    child.once("exit", resolve);
    child.send("shutdown", () => {});
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000).unref();
  });

async function probe(framework, p) {
  const { child, port } = await start(framework, p.env ?? {});
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p.path}`, {
      method: p.method ?? "GET",
      headers: p.headers,
      body: p.body,
    });
    const body = Buffer.from(await r.arrayBuffer());
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      length: r.headers.get("content-length"),
      chunked: r.headers.get("transfer-encoding"),
      body,
    };
  } finally {
    await stop(child);
  }
}

// Media type only: charset spelling differs between frameworks (cpeak omits
// it, Express writes UTF-8 on files) without changing the work measured.
const mediaType = (t) => (t ?? "").split(";")[0].trim().toLowerCase();

let failures = 0;
for (const p of PROBES) {
  const results = {};
  for (const f of FRAMEWORKS) results[f] = await probe(f, p);
  const ref = results[FRAMEWORKS[0]];
  const line = FRAMEWORKS.map((f) => {
    const r = results[f];
    const same =
      r.status === (p.expect ?? 200) &&
      (p.bodyMayDiffer ||
        (r.body.equals(ref.body) &&
          mediaType(r.type) === mediaType(ref.type) &&
          r.length === ref.length));
    if (!same) failures++;
    const summary = `${r.status} ${r.type ?? "-"} len=${r.length ?? (r.chunked ? "chunked" : "-")} body=${r.body.length}B`;
    return `${same ? "ok " : "XX "}${f.padEnd(8)} ${summary}`;
  });
  console.log(`${p.id}`);
  for (const l of line) console.log(`  ${l}`);
}
console.log(
  failures === 0
    ? "\nSMOKE OK: every framework serves identical bytes"
    : `\nSMOKE FAILED: ${failures} mismatch(es)`,
);
process.exit(failures === 0 ? 0 : 1);
