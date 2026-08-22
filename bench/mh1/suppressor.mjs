// MH-1 harness-suppressor hunt: which ingredient of bench/servers/fastify.js at
// 200 routes denies Fastify its fast mode?
//
//   node bench/container.mjs --no-build -- node bench/mh1/suppressor.mjs --rounds=20
//
// Every variant is sampled ROUNDS times in FRESH processes, variants
// interleaved round-robin so a session band shift charges all of them alike.
// A process is "fast" when it reads >= FAST_FACTOR x the slowest process of
// the whole run. The two minimal controls (R6, R200) tell whether the session
// offers the fast mode at all: if they read 0/N, nothing here can discriminate
// and the run says so instead of inventing a suppressor.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scaleProbePaths } from "../servers/shared.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const ROUNDS = Number(args.get("rounds") ?? 20);
const FAST_FACTOR = 1.3;

const ALL = "hello,users,chain,files,echo";
// name -> { fixed, scale, paths, handler }
const VARIANTS = {
  R6: { fixed: "", scale: 6, paths: 1 }, // minimal control, small table
  R200: { fixed: "", scale: 200, paths: 1 }, // minimal control, large table
  "A-bench": { fixed: ALL, scale: 200, paths: 10 }, // = bench/servers/fastify.js @200, matrix traffic
  "A1-bench-1path": { fixed: ALL, scale: 200, paths: 1 }, // bench server, single path
  "B-min-10paths": { fixed: "", scale: 200, paths: 10 }, // minimal server, matrix traffic
  "C-hello-users": { fixed: "hello,users", scale: 200, paths: 1 },
  "D-chain": { fixed: "chain", scale: 200, paths: 1 },
  "E-files": { fixed: "files", scale: 200, paths: 1 },
  "F-echo": { fixed: "echo", scale: 200, paths: 1 },
  // Traffic-shape controls: is it the number of DISTINCT routes requested?
  "R6-2paths": { fixed: "", scale: 6, paths: 2 },
  "R6-6paths": { fixed: "", scale: 6, paths: 6 },
  "R200-2paths": { fixed: "", scale: 200, paths: 2 },
};
const wanted = args.get("variants")?.split(",") ?? Object.keys(VARIANTS);

let port = 5200;
const fmt = (n) => Math.round(n).toLocaleString("en-US");

function run(v) {
  return new Promise((resolve, reject) => {
    const bound = ++port;
    const child = spawn(process.execPath, ["bench/mh1/variant.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(bound),
        FIXED: v.fixed,
        SCALE: String(v.scale),
        HANDLER: v.handler ?? "async",
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const timer = setTimeout(() => reject(new Error("never ready")), 20000);
    child.once("message", async () => {
      clearTimeout(timer);
      const paths = v.paths === 1 ? ["/api/v1/res0/12345"] : scaleProbePaths(v.scale, v.paths);
      const load = {
        url: `http://127.0.0.1:${bound}`,
        connections: 100,
        pipelining: 10,
        requests: paths.map((path) => ({ path })),
      };
      try {
        await autocannon({ ...load, duration: 2 });
        const r = await autocannon({ ...load, duration: 4 });
        const stats = r.statusCodeStats ?? {};
        const total = Object.values(stats).reduce((s, x) => s + (x.count ?? 0), 0);
        if (total === 0 || (stats["200"]?.count ?? 0) !== total) {
          reject(new Error(`non-200s: ${JSON.stringify(stats)}`));
          return;
        }
        resolve(r.requests.average);
      } catch (err) {
        reject(err);
      } finally {
        child.kill();
      }
    });
  });
}

const samples = Object.fromEntries(wanted.map((n) => [n, []]));
console.log(`MH-1 suppressor hunt: ${wanted.length} variants x ${ROUNDS} fresh processes\n`);
for (let round = 1; round <= ROUNDS; round++) {
  const line = [];
  for (const name of wanted) {
    const rps = await run(VARIANTS[name]);
    samples[name].push(rps);
    line.push(`${name} ${Math.round(rps / 1000)}k`);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`round ${round}: ${line.join(" | ")}`);
}

const all = Object.values(samples).flat();
const floor = Math.min(...all) * FAST_FACTOR;
console.log(
  `\nfast band = >= ${fmt(floor)} (${FAST_FACTOR}x the slowest process, ${fmt(Math.min(...all))})\n`,
);
console.log("| variant | fixed routes | scale | paths | fast / total | common band | fast band |");
console.log("| --- | --- | ---: | ---: | ---: | --- | --- |");
for (const name of wanted) {
  const v = VARIANTS[name];
  const xs = samples[name];
  const fast = xs.filter((x) => x >= floor);
  const common = xs.filter((x) => x < floor);
  const band = (ys) => (ys.length ? `${fmt(Math.min(...ys))}–${fmt(Math.max(...ys))}` : "—");
  console.log(
    `| ${name} | ${v.fixed || "(none)"} | ${v.scale} | ${v.paths} | **${fast.length} / ${xs.length}** | ${band(common)} | ${band(fast)} |`,
  );
}
const control = samples.R6 ?? [];
if (control.length && control.filter((x) => x >= floor).length === 0) {
  console.log(
    "\nNOTE: the minimal 6-route control never reached the fast band — this session does not offer the mode; nothing above discriminates.",
  );
}
