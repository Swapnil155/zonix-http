// Candidate minimal repro for the Fastify route-table-size throughput cliff.
//
// STATUS (2026-08-21): DOES NOT YET REPRODUCE THE EFFECT — do not file.
// The full bench harness (`bench/scaling.mjs` + `bench/servers/fastify.js`)
// shows the cliff, re-verified the same day this was written (93,424 ->
// 70,896 rps going 6 -> 200 routes, -24%). This stripped-down server does
// not: on the same machine it reads flat-to-inverted. A paired swap test
// (both servers measured by the same parent, interleaved in the same rounds)
// localizes the trigger to something in `bench/servers/fastify.js` that this
// file does not replicate — and three candidates have been falsified:
// handler style (async return vs reply.send), the six-route fixed mix
// registered before the scale routes, and a shared route-options object.
// Isolation must finish, on a quiet machine, before any upstream filing.
//
//   npm i fastify autocannon
//   node repro.mjs                 # pairs 6 vs 200 routes, both handler
//                                  # styles, interleaved, 3 rounds
//
// Methodology, kept even though the effect is not yet caught here:
//   - each table size runs in a FRESH child process (no JIT state carryover);
//   - configs are INTERLEAVED across rounds so machine drift charges all
//     equally; the figure is the median of per-round ratios;
//   - a 2s warmup run precedes each 5s measured run;
//   - one requested path throughout (the first route registered), so the
//     router walk is held constant while the table size varies.
//
// In the full harness's profiles the lookup is NOT the cost: find-my-way's
// `find` stays at 1.2-1.4% of self-time at both 6 and 200 routes, while
// `process.nextTick` grows from ~1% to ~22%.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SIZES = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [6, 200];
const STYLES = ["async", "callback"];
const ROUNDS = 3;
let port = 3900; // incremented per run: a fresh port avoids TIME_WAIT backlog
const SELF = fileURLToPath(import.meta.url);

// --- child mode: plain Fastify server with N param routes --------------------
if (process.env.REPRO_ROUTES) {
  const Fastify = (await import("fastify")).default;
  const app = Fastify({ logger: false });
  const n = Number(process.env.REPRO_ROUTES);
  const style = process.env.REPRO_STYLE ?? "async";
  if (process.env.REPRO_FIXED) {
    // The six-route mix a realistic app carries alongside the scale table:
    // a static root, a param route, a hook-bearing route, a POST (a second
    // method tree), and two more statics. Used to bisect whether the cliff
    // needs this mix present.
    const link = (req, reply, done) => done();
    app.get("/", async () => ({ hello: "world" }));
    app.get("/users/:id", async (req) => ({ id: req.params.id }));
    app.get("/chain", { onRequest: Array.from({ length: 10 }, () => link) }, async () => ({
      ok: true,
    }));
    app.post("/echo", async (req) => req.body);
    app.get("/file/small", async () => "x");
    app.get("/file/large", async () => "x");
  }
  const opts = {}; // one shared empty options object, as a route registry commonly does
  for (let i = 0; i < n; i++) {
    if (style === "async") {
      // Promise path: the handler returns a value, Fastify serializes it.
      if (process.env.REPRO_OPTS)
        app.get(`/api/v1/res${i}/:id`, opts, async (req) => ({ id: req.params.id }));
      else app.get(`/api/v1/res${i}/:id`, async (req) => ({ id: req.params.id }));
    } else {
      // Callback path: reply.send, no promise machinery.
      app.get(`/api/v1/res${i}/:id`, (req, reply) => reply.send({ id: req.params.id }));
    }
  }
  await app.listen({ port: Number(process.env.REPRO_PORT), host: "127.0.0.1" });
  process.send?.("ready");
} else {
  // --- parent mode -----------------------------------------------------------
  const run = (routes, style) =>
    new Promise((resolve, reject) => {
      const bound = ++port;
      const child = spawn(process.execPath, [SELF], {
        env: {
          ...process.env,
          REPRO_ROUTES: String(routes),
          REPRO_STYLE: style,
          REPRO_PORT: String(bound),
        },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      child.once("message", async () => {
        const load = {
          url: `http://127.0.0.1:${bound}`,
          connections: 100,
          pipelining: 10,
          requests: [{ path: "/api/v1/res0/123" }],
        };
        try {
          await autocannon({ ...load, duration: 2 }); // warmup
          const result = await autocannon({ ...load, duration: 5 });
          resolve(result.requests.average);
        } catch (err) {
          reject(err);
        } finally {
          child.kill();
          setTimeout(() => resolve(0), 2000).unref?.();
        }
      });
    });

  console.log(
    `node ${process.version} — one requested path, sizes+styles interleaved, ${ROUNDS} rounds\n`,
  );
  const results = {};
  for (const style of STYLES) for (const size of SIZES) results[`${style}:${size}`] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const line = [];
    for (const style of STYLES) {
      for (const size of SIZES) {
        const rps = await run(size, style);
        results[`${style}:${size}`].push(rps);
        line.push(`${style}/${size}r ${Math.round(rps).toLocaleString("en-US")}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    console.log(`round ${round}: ${line.join(" | ")}`);
  }

  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log("\nmedians (200-route figure as a share of the 6-route figure):");
  for (const style of STYLES) {
    const base = median(results[`${style}:${SIZES[0]}`]);
    const cells = SIZES.map((size) => {
      const m = median(results[`${style}:${size}`]);
      const share = size === SIZES[0] ? "" : ` (${((m / base) * 100).toFixed(1)}%)`;
      return `${size}r ${Math.round(m).toLocaleString("en-US")}${share}`;
    });
    console.log(`  ${style.padEnd(8)}: ${cells.join(" | ")}`);
  }
}
