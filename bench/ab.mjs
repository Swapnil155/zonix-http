// A/B two builds of zonix in a single session, alternating runs.
//
//   node bench/snapshot.mjs                       # freeze the current dist as the baseline
//   ...make a change, npm run build...
//   node bench/ab.mjs --scenario=chain --runs=5   # baseline vs candidate
//
// Why alternating: within-run spread on this machine is ~1-5%, but the drift
// BETWEEN sessions is larger than that. Comparing a number taken today against
// one taken an hour ago cannot justify a 1% keep/revert decision. Interleaving
// A,B,A,B,... in one session cancels slow drift, and the median of the paired
// deltas is what gets recorded.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureFixtures } from "./fixtures.mjs";
import {
  compareRegimes,
  measureRegime,
  reportRegime,
  reportRegimeFlip,
  measureCpu,
  reportCpu,
} from "./regime.mjs";

const SCENARIOS = {
  hello: { path: "/", connections: 100, pipelining: 10, duration: 5 },
  param: { path: "/users/42", connections: 100, pipelining: 10, duration: 5 },
  chain: { path: "/chain", connections: 100, pipelining: 10, duration: 5 },
  notfound: { path: "/no-such-route", connections: 100, pipelining: 10, duration: 5 },
  "file-1kb": { path: "/file/small", connections: 100, pipelining: 10, duration: 5 },
  "file-1mb": { path: "/file/large", connections: 50, pipelining: 1, duration: 5 },
};

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const root = fileURLToPath(new URL("..", import.meta.url));
const names = (args.get("scenario") ?? "hello").split(",");
const runs = Number(args.get("runs") ?? 7);
// "optimize" (default) judges a candidate that is trying to be faster.
// "gate" judges a phase close, where the bar is simply "did not regress"
// (CLAUDE.md performance rule 2: no more than 2% off hello-world).
const mode = args.get("mode") ?? "optimize";
const REGRESSION_BUDGET = -2;
const settleMs = Number(args.get("settle") ?? 750);
const baseline = args.get("baseline") ?? "../.baseline-build/index.js";
const candidate = args.get("candidate") ?? "../../dist/index.js";

const baselineAbs = fileURLToPath(new URL(`./servers/${baseline}`, import.meta.url));
if (!existsSync(baselineAbs)) {
  console.error(`No baseline build at ${baselineAbs}\nRun: node bench/snapshot.mjs`);
  process.exit(1);
}

function startServer(entry, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bench/servers/zonix.js"], {
      cwd: root,
      env: { ...process.env, PORT: String(port), ZONIX_ENTRY: entry },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const timer = setTimeout(() => reject(new Error("server never signalled ready")), 20000);
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

// A fresh port for every measurement: rebinding a just-closed port on Windows
// can land on a socket still in TIME_WAIT and skew the run.
const cpu = await measureCpu();
reportCpu(cpu);
console.log("");

// Rule 7 preflight. A paired A/B survives a degraded regime better than a
// cross-framework run does, but the stamp still has to appear on the record.
let regime;
if (names.some((n) => n.startsWith("file-"))) {
  const { SMALL } = ensureFixtures();
  regime = measureRegime(SMALL);
  reportRegime(regime);
  console.log("");
}

let nextPort = 3100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(entry, scenario) {
  const port = nextPort++;
  const child = await startServer(entry, port);
  try {
    const url = `http://127.0.0.1:${port}${scenario.path}`;
    await autocannon({ url, ...scenario, duration: 2 }); // warmup
    const r = await autocannon({ url, ...scenario, duration: scenario.duration });
    return r.requests.average;
  } finally {
    await stop(child);
    await sleep(settleMs); // let the OS reclaim sockets before the next server
  }
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

for (const name of names) {
  const base = SCENARIOS[name];
  if (!base) {
    console.error(`Unknown scenario "${name}"`);
    process.exit(1);
  }
  // Load level is overridable: the noise floor depends heavily on how much CPU
  // the autocannon client steals from the server.
  const scenario = {
    ...base,
    connections: Number(args.get("connections") ?? base.connections),
    pipelining: Number(args.get("pipelining") ?? base.pipelining),
    duration: Number(args.get("duration") ?? base.duration),
  };

  const a = [];
  const b = [];
  const paired = [];

  process.stdout.write(`${name}: `);
  for (let i = 0; i < runs; i++) {
    // Alternate which side goes first so ordering cannot favour either build.
    const baselineFirst = i % 2 === 0;
    let ra, rb;
    if (baselineFirst) {
      ra = await measure(baseline, scenario);
      rb = await measure(candidate, scenario);
    } else {
      rb = await measure(candidate, scenario);
      ra = await measure(baseline, scenario);
    }
    a.push(ra);
    b.push(rb);
    paired.push((rb - ra) / ra);
    process.stdout.write(
      `${((rb - ra) / ra >= 0 ? "+" : "") + (((rb - ra) / ra) * 100).toFixed(1)}% `,
    );
  }

  const mA = median(a);
  const mB = median(b);
  const deltaOfMedians = ((mB - mA) / mA) * 100;
  const medianOfDeltas = median(paired) * 100;
  const worst = Math.min(...paired) * 100;
  const best = Math.max(...paired) * 100;

  console.log("");
  console.log(`  baseline  median ${Math.round(mA).toLocaleString("en-US")} rps`);
  console.log(`  candidate median ${Math.round(mB).toLocaleString("en-US")} rps`);
  console.log(
    `  delta ${deltaOfMedians >= 0 ? "+" : ""}${deltaOfMedians.toFixed(2)}% (median of paired deltas ` +
      `${medianOfDeltas >= 0 ? "+" : ""}${medianOfDeltas.toFixed(2)}%, range ${worst.toFixed(1)}%..${best.toFixed(1)}%)`,
  );
  const verdict =
    mode === "gate"
      ? medianOfDeltas >= REGRESSION_BUDGET
        ? `PASS (budget ${REGRESSION_BUDGET}%, measured ${medianOfDeltas.toFixed(2)}%)`
        : `FAIL (worse than the ${REGRESSION_BUDGET}% budget)`
      : medianOfDeltas >= 1
        ? "KEEP (>= +1% on target scenario)"
        : medianOfDeltas <= -1
          ? "REGRESSION"
          : "REVERT (< 1% win: complexity has a budget)";
  console.log(`  verdict: ${verdict}`);
  console.log("");
}

// Rule 7 is pre AND post: a mid-run regime flip voids the file numbers.
if (regime !== undefined) {
  const { SMALL } = ensureFixtures();
  reportRegimeFlip(compareRegimes(regime, measureRegime(SMALL)));
}
