// M1 prerequisite: the zonix cache-on variant (ZONIX_STATIC_CACHE=1) must be
// wire-identical to the default on the bench file routes BEFORE any number is
// taken - status line, every header except Date, and the body, on a cold
// request and a warm one (the hit is what the cache row measures).
//
//   node bench/smoke-cache.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PATHS = ["/file/small", "/file/large"];
const PROBES = [
  ["GET", {}],
  ["HEAD", {}],
  ["GET", { Range: "bytes=0-9" }],
  ["GET", { Range: "bytes=-5" }],
  ["GET", { Range: "bytes=9999999-" }],
  ["GET", { "If-Modified-Since": "Thu, 01 Jan 2026 00:00:00 GMT" }],
  ["GET", { "If-Modified-Since": "Wed, 31 Dec 2025 00:00:00 GMT" }],
  ["GET", { "Accept-Encoding": "gzip, br" }],
];

let nextPort = 3900;
function start(env) {
  return new Promise((resolve, reject) => {
    const port = nextPort++;
    const child = spawn(process.execPath, ["bench/servers/zonix.js"], {
      cwd: root,
      env: { ...process.env, PORT: String(port), ...env },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const timer = setTimeout(() => reject(new Error("zonix never signalled ready")), 20000);
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

function raw(port, method, path, headers) {
  return new Promise((resolve, reject) => {
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`);
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `${method} ${path} HTTP/1.1\r\nHost: t\r\nConnection: close\r\n${lines.join("")}\r\n`,
      );
    });
    const chunks = [];
    socket.on("data", (d) => chunks.push(d));
    socket.on("error", reject);
    socket.on("close", () => {
      const all = Buffer.concat(chunks);
      const i = all.indexOf("\r\n\r\n");
      const head = all.subarray(0, i).toString("latin1").split("\r\n");
      const headers = head
        .slice(1)
        .filter((l) => !/^date:/i.test(l))
        .sort();
      resolve({ status: head[0], headers, body: all.subarray(i + 4) });
    });
  });
}

const off = await start({});
const on = await start({ ZONIX_STATIC_CACHE: "1" });
let failures = 0;
let checked = 0;
try {
  for (const path of PATHS) {
    for (const [method, headers] of PROBES) {
      const a = await raw(off.port, method, path, headers);
      for (const pass of ["cold", "warm"]) {
        const b = await raw(on.port, method, path, headers);
        checked++;
        const same =
          a.status === b.status &&
          a.headers.join("\n") === b.headers.join("\n") &&
          a.body.equals(b.body);
        if (!same) {
          failures++;
          console.log(`XX ${pass} ${method} ${path} ${JSON.stringify(headers)}`);
          console.log(`   off: ${a.status} | ${a.headers.join(" | ")} | ${a.body.length}B`);
          console.log(`   on:  ${b.status} | ${b.headers.join(" | ")} | ${b.body.length}B`);
        }
      }
    }
  }
} finally {
  await Promise.all([stop(off.child), stop(on.child)]);
}
console.log(
  failures === 0
    ? `SMOKE-CACHE OK: ${checked} responses wire-identical (cache-on cold+warm vs default)`
    : `SMOKE-CACHE FAILED: ${failures}/${checked} differ`,
);
process.exit(failures === 0 ? 0 : 1);
