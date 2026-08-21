// Bisect driver: does the cliff need the fixed-route mix? async style, 6 vs
// 200 scale routes, with and without the fixed six, interleaved, 3 rounds.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPRO = fileURLToPath(new URL("./repro.mjs", import.meta.url));
let port = 4200;

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const run = (routes, mode) =>
  new Promise((resolve, reject) => {
    const bound = ++port;
    let child;
    if (mode === "bench") {
      // The exact server file the recorded harness spawns.
      child = spawn(process.execPath, ["bench/servers/fastify.js"], {
        cwd: ROOT,
        env: { ...process.env, BENCH_ROUTES: String(routes), PORT: String(bound) },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
    } else {
      const env = {
        ...process.env,
        REPRO_ROUTES: String(routes),
        REPRO_STYLE: "async",
        REPRO_PORT: String(bound),
      };
      if (mode === "opts") env.REPRO_OPTS = "1";
      child = spawn(process.execPath, [REPRO], {
        env,
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
    }
    child.once("message", async () => {
      const load = {
        url: `http://127.0.0.1:${bound}`,
        connections: 100,
        pipelining: 10,
        requests: [{ path: "/api/v1/res0/12345" }],
      };
      try {
        await autocannon({ ...load, duration: 2 });
        const result = await autocannon({ ...load, duration: 5 });
        resolve(result.requests.average);
      } catch (e) {
        reject(e);
      } finally {
        child.kill();
      }
    });
  });

const configs = [
  ["opts 6", 6, "opts"],
  ["opts 200", 200, "opts"],
  ["plain 6", 6, false],
  ["plain 200", 200, false],
];
const results = Object.fromEntries(configs.map(([n]) => [n, []]));
for (let round = 1; round <= 3; round++) {
  const line = [];
  for (const [name, routes, mode] of configs) {
    const rps = await run(routes, mode);
    results[name].push(rps);
    line.push(`${name} ${Math.round(rps).toLocaleString("en-US")}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`round ${round}: ${line.join(" | ")}`);
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log("\nmedians:");
for (const [name] of configs)
  console.log(`  ${name.padEnd(10)} ${Math.round(median(results[name])).toLocaleString("en-US")}`);
const [a6, a200, b6, b200] = configs.map(([n]) => n);
console.log(`\n  ${a200} / ${a6} = ${(median(results[a200]) / median(results[a6])).toFixed(3)}`);
console.log(`  ${b200} / ${b6} = ${(median(results[b200]) / median(results[b6])).toFixed(3)}`);
