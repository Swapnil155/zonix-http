// Does throughput depend on how many routes are REGISTERED, or on how many
// distinct paths are REQUESTED?
//
//   node bench/scaling.mjs
//   node bench/scaling.mjs --frameworks=zonix,fastify --routes=6,50,200,400
//
// Built for W2-V. The routes-200-param win needed a named mechanism before it
// could be published, and the two variables the scenario changes at once are
// table size and request variety. This separates them: hold the requested path
// count at 1 and sweep the registered table, then hold the table and sweep the
// requested variety. A framework whose cost tracks the registered count pays for
// routes it never serves.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measureCpu, reportCpu } from "./regime.mjs";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const frameworks = (args.get("frameworks") ?? "zonix,fastify,express").split(",");
const routeCounts = (args.get("routes") ?? "6,25,50,100,200,400").split(",").map(Number);
const variety = (args.get("variety") ?? "1").split(",").map(Number);
const duration = Number(args.get("duration") ?? 4);
const root = fileURLToPath(new URL("..", import.meta.url));

let port = 3800;

function start(framework, routes) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`bench/servers/${framework}.js`], {
      cwd: root,
      env: { ...process.env, PORT: String(++port), BENCH_ROUTES: String(routes) },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const timer = setTimeout(() => reject(new Error(`${framework} never signalled ready`)), 20000);
    child.once("message", (m) => {
      if (m === "ready") {
        clearTimeout(timer);
        resolve(child);
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

async function measure(framework, routes, distinctPaths) {
  const child = await start(framework, routes);
  const bound = port;
  try {
    const step = Math.max(1, Math.floor(routes / distinctPaths));
    const paths = [];
    for (let i = 0; i < routes && paths.length < distinctPaths; i += step) {
      paths.push(`/api/v1/res${i}/12345`);
    }
    const load = {
      url: `http://127.0.0.1:${bound}/`,
      connections: 100,
      pipelining: 10,
      requests: paths.map((path) => ({ path })),
    };
    await autocannon({ ...load, duration: 2 });
    const result = await autocannon({ ...load, duration });
    const stats = result.statusCodeStats ?? {};
    const total = Object.values(stats).reduce((sum, v) => sum + (v.count ?? 0), 0);
    if (total > 0 && (stats["200"]?.count ?? 0) !== total) {
      throw new Error(`${framework}: not all responses were 200 at ${routes} routes`);
    }
    return result.requests.average;
  } finally {
    await stop(child);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");

reportCpu(await measureCpu());
console.log("");
console.log("Throughput vs routes registered (requested path variety held fixed)");
console.log("");
console.log(`| framework | variety | ${routeCounts.map((r) => `${r} routes`).join(" | ")} |`);
console.log(`| --- | ---: | ${routeCounts.map(() => "---:").join(" | ")} |`);

for (const framework of frameworks) {
  for (const distinct of variety) {
    const cells = [];
    for (const routes of routeCounts) {
      cells.push(fmt(await measure(framework, routes, Math.min(distinct, routes))));
    }
    console.log(`| ${framework} | ${distinct} | ${cells.join(" | ")} |`);
  }
}
