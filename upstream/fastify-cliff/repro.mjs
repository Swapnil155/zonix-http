// Minimal repro: Fastify per-request throughput CHANGES with the number of
// registered routes — with a SINGLE requested path, so only the size of the
// table varies, never the traffic.
//
// What it is (Session 13, pinned linux container, fresh process per run):
// Fastify's per-process throughput is BIMODAL. With 200 routes every process
// ran at the common mode (12/12, ~105k req/s at --cpus=8). With 6 routes a
// process sometimes lands in a FAST mode ~55% higher (2/12 here; the default
// on our Windows host in fast-machine bands). So "200 routes is 30% slower"
// really means "the fast mode was never observed with a large table". Run
// with ROUNDS=20 to sample the mode rate; read each round's 6-route figure
// as a draw, not a mean. A zonix control measured alongside is flat
// (0.97-1.01) in every window and order, with no modes.
//
//   npm i fastify autocannon
//   node repro.mjs                # sweeps 6, 50, 100, 200 routes
//   node repro.mjs 6 200         # just the endpoints
//   ROUNDS=5 node repro.mjs      # more rounds
//   STYLE=callback node repro.mjs  # reply.send instead of async handlers
//                                  # (both styles show the effect)
//
// The server under test is nothing but this:
//
//   const app = Fastify({ logger: false });
//   for (let i = 0; i < n; i++) {
//     app.get(`/api/v1/res${i}/:id`, async (req) => ({ id: req.params.id }));
//   }
//
// Methodology, so the number can be trusted:
//   - each table size runs in a FRESH child process (no JIT state carryover);
//   - sizes are INTERLEAVED across rounds (6,50,...,6,50,...) so machine
//     drift charges every size equally; the figure is the median across
//     rounds, and per-round first-vs-last ratios are printed;
//   - a 2s warmup run precedes each 4s measured run;
//   - every run asserts all responses were 200;
//   - the requested path is always GET /api/v1/res0/12345 — the FIRST route
//     registered — so the router walk is held constant while the table grows.
//
// What our profiles show (Fastify 5.12.1, find-my-way 9.8.0, Node 22.20.0):
// the lookup is NOT the cost — find-my-way's `find` stays at 1.2-1.4% of
// self-time at both 6 and 200 routes, while `process.nextTick` grows from
// ~1% to ~22% of self-time. Also ruled out by direct test: distinct handler
// closures (a single shared closure behaves the same), requested-path
// variety, schema compilation, GC pressure (GC share falls), handler style
// (async vs reply.send both show it).
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SIZES = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [6, 50, 100, 200];
const ROUNDS = Number(process.env.ROUNDS ?? 3);
let port = 3900; // incremented per run: a fresh port avoids TIME_WAIT backlog
const SELF = fileURLToPath(import.meta.url);

// --- child mode: the minimal Fastify server ----------------------------------
if (process.env.REPRO_ROUTES) {
  const Fastify = (await import("fastify")).default;
  const app = Fastify({ logger: false });
  const n = Number(process.env.REPRO_ROUTES);
  for (let i = 0; i < n; i++) {
    if (process.env.STYLE === "callback") {
      app.get(`/api/v1/res${i}/:id`, (req, reply) => reply.send({ id: req.params.id }));
    } else {
      app.get(`/api/v1/res${i}/:id`, async (req) => ({ id: req.params.id }));
    }
  }
  await app.listen({ port: Number(process.env.REPRO_PORT), host: "127.0.0.1" });
  process.send?.("ready");
} else {
  // --- parent mode -----------------------------------------------------------
  const run = (routes) =>
    new Promise((resolve, reject) => {
      const bound = ++port;
      const child = spawn(process.execPath, [SELF], {
        env: { ...process.env, REPRO_ROUTES: String(routes), REPRO_PORT: String(bound) },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      child.once("message", async () => {
        const load = {
          url: `http://127.0.0.1:${bound}`,
          connections: 100,
          pipelining: 10,
          requests: [{ path: "/api/v1/res0/12345" }],
        };
        try {
          await autocannon({ ...load, duration: 2 }); // warmup
          const result = await autocannon({ ...load, duration: 4 });
          const stats = result.statusCodeStats ?? {};
          const total = Object.values(stats).reduce((sum, v) => sum + (v.count ?? 0), 0);
          if (total > 0 && (stats["200"]?.count ?? 0) !== total) {
            reject(new Error(`non-200 responses at ${routes} routes: ${JSON.stringify(stats)}`));
            return;
          }
          resolve(result.requests.average);
        } catch (err) {
          reject(err);
        } finally {
          child.kill();
        }
      });
    });

  const style = process.env.STYLE === "callback" ? "reply.send callback" : "async";
  console.log(
    `node ${process.version} — ${style} handlers, one requested path, ` +
      `sizes interleaved, ${ROUNDS} rounds\n`,
  );
  const results = Object.fromEntries(SIZES.map((s) => [s, []]));
  for (let round = 1; round <= ROUNDS; round++) {
    const line = [];
    for (const size of SIZES) {
      const rps = await run(size);
      results[size].push(rps);
      line.push(`${size}r ${Math.round(rps).toLocaleString("en-US")}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`round ${round}: ${line.join(" | ")}`);
  }

  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const base = median(results[SIZES[0]]);
  console.log("\nmedians:");
  for (const size of SIZES) {
    const m = median(results[size]);
    console.log(
      `  ${String(size).padStart(4)} routes: ${Math.round(m).toLocaleString("en-US")} req/s` +
        (size === SIZES[0] ? "  (baseline)" : `  (${((m / base) * 100).toFixed(1)}%)`),
    );
  }
  const first = SIZES[0];
  const last = SIZES[SIZES.length - 1];
  const perRound = results[first].map((v, i) => results[last][i] / v);
  console.log(
    `\nper-round ${last}/${first} ratios: ${perRound.map((r) => r.toFixed(3)).join(", ")}`,
  );
}
