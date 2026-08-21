// Strip-isolation driver: the verbatim bench server (known to cliff) against
// stripped variants, 6 vs 200 scale routes, interleaved, N rounds. The first
// variant whose 200/6 ratio stops cliffing names the ingredient.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const VARIANTS = (process.env.VARIANTS ?? "A,B,C").split(",");
const FILES = {
  A: "bench/servers/fastify.js",
  B: "upstream/fastify-cliff/variants/b-no-files.mjs",
  C: "upstream/fastify-cliff/variants/c-scale-only.mjs",
  D: "upstream/fastify-cliff/variants/d-inline.mjs",
  E: "upstream/fastify-cliff/variants/e-callback.mjs",
};
let port = 4500;

const run = (file, routes) =>
  new Promise((resolve) => {
    const bound = ++port;
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      env: { ...process.env, BENCH_ROUTES: String(routes), PORT: String(bound) },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    child.once("message", async () => {
      const load = {
        url: `http://127.0.0.1:${bound}`,
        connections: 100,
        pipelining: 10,
        requests: [{ path: "/api/v1/res0/12345" }],
      };
      await autocannon({ ...load, duration: 2 });
      const result = await autocannon({ ...load, duration: 4 });
      const stats = result.statusCodeStats ?? {};
      const total = Object.values(stats).reduce((sum, v) => sum + (v.count ?? 0), 0);
      if (total > 0 && (stats["200"]?.count ?? 0) !== total) {
        console.error(`  WARNING ${file} @ ${routes}: non-200s present`, stats);
      }
      child.kill();
      resolve(result.requests.average);
    });
  });

const results = {};
for (const v of VARIANTS) for (const size of [6, 200]) results[`${v}:${size}`] = [];

for (let round = 1; round <= ROUNDS; round++) {
  const line = [];
  for (const v of VARIANTS) {
    for (const size of [6, 200]) {
      const rps = await run(FILES[v], size);
      results[`${v}:${size}`].push(rps);
      line.push(`${v}/${size} ${Math.round(rps / 1000)}k`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.log(`round ${round}: ${line.join(" | ")}`);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log("\nper-variant 200/6 ratios (per round, then median):");
for (const v of VARIANTS) {
  const per = results[`${v}:6`].map((x, i) => results[`${v}:200`][i] / x);
  console.log(
    `  ${v}: ${per.map((r) => r.toFixed(3)).join(", ")}  median ${median(per).toFixed(3)}` +
      `  (${median(per) < 0.9 ? "CLIFFS" : "no cliff"})`,
  );
}
