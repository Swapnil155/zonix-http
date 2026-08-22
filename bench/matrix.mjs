// Full fresh matrix, rotating order, built for the D8 container.
//
//   node bench/container.mjs --abort-busy -- node bench/matrix.mjs --rounds=5
//
// Every scenario x every framework, one process alive at a time, the framework
// order rotated every round so drift lands on nobody in particular. Reports
// EVERY per-round value (a bimodal framework looks different from a noisy one),
// asserts the expected status per scenario (the 404 scenario passes only when
// 404s are 100%), checks the regime before AND after (rule 7), and prints the
// results.md table at the end. Ratios are the claim; absolutes never are.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureFixtures } from "./fixtures.mjs";
import { ECHO_BODY_JSON, scaleProbePaths } from "./servers/shared.mjs";
import {
  compareRegimes,
  formatFingerprint,
  formatRegime,
  measureRegime,
  reportRegime,
  reportRegimeFlip,
  measureCpu,
  reportCpu,
} from "./regime.mjs";

const C = { connections: 100, pipelining: 10, duration: 5, expect: 200 };
const SCENARIOS = [
  { id: "hello", path: "/", ...C },
  {
    id: "routes-6-param",
    path: "/api/v1/res0/12345",
    requests: scaleProbePaths(6, 10).map((path) => ({ path })),
    env: { BENCH_ROUTES: "6" },
    ...C,
  },
  {
    id: "routes-200-param",
    path: "/api/v1/res0/12345",
    requests: scaleProbePaths(200, 10).map((path) => ({ path })),
    env: { BENCH_ROUTES: "200" },
    ...C,
  },
  { id: "chain", path: "/chain", ...C },
  { id: "404", path: "/no-such-route", ...C, expect: 404 },
  {
    id: "post-json-echo",
    path: "/echo",
    method: "POST",
    body: ECHO_BODY_JSON,
    headers: { "content-type": "application/json" },
    ...C,
  },
  { id: "file-1kb", path: "/file/small", ...C },
  // Informational only: pipelining a 1MB body measures the kernel.
  {
    id: "file-1mb",
    path: "/file/large",
    ...C,
    connections: 50,
    pipelining: 1,
    informational: true,
  },
];
// A framework id names a server script plus the env that selects its variant.
const FRAMEWORK_SPEC = {
  zonix: { script: "zonix" },
  "zonix-cache": { script: "zonix", env: { ZONIX_STATIC_CACHE: "1" } },
  express: { script: "express" },
  fastify: { script: "fastify" },
  cpeak: { script: "cpeak" },
};
const ALL_FRAMEWORKS = Object.keys(FRAMEWORK_SPEC);

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const minRounds = Number(args.get("rounds") ?? 5);
const maxRounds = Number(args.get("max-rounds") ?? minRounds + 3);
const settleMs = Number(args.get("settle") ?? 750);
const wanted = args.get("scenarios")?.split(",");
const FRAMEWORKS = (args.get("frameworks") ?? "zonix,express,fastify").split(",");
for (const f of FRAMEWORKS) {
  if (!ALL_FRAMEWORKS.includes(f)) {
    console.error(`Unknown framework ${f}`);
    process.exit(1);
  }
}
const others = FRAMEWORKS.filter((f) => f !== "zonix");
const scenarios = SCENARIOS.filter((s) => !wanted || wanted.includes(s.id));
const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spreadOf = (xs) => ((Math.max(...xs) - Math.min(...xs)) / median(xs)) * 100;

reportCpu(await measureCpu());
console.log("");
const { SMALL } = ensureFixtures();
const regimePre = measureRegime(SMALL);
reportRegime(regimePre);
console.log("");

let nextPort = 3500;

function start(framework, port, scenario) {
  return new Promise((resolve, reject) => {
    const spec = FRAMEWORK_SPEC[framework];
    const child = spawn(process.execPath, [`bench/servers/${spec.script}.js`], {
      cwd: root,
      env: { ...process.env, PORT: String(port), ...(spec.env ?? {}), ...(scenario.env ?? {}) },
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

async function measure(framework, scenario) {
  const port = nextPort++;
  const child = await start(framework, port, scenario);
  try {
    const options = {
      url: `http://127.0.0.1:${port}${scenario.path}`,
      connections: scenario.connections,
      pipelining: scenario.pipelining,
    };
    for (const k of ["method", "body", "headers", "requests"]) {
      if (scenario[k] !== undefined) options[k] = scenario[k];
    }
    await autocannon({ ...options, duration: 2 }); // one warmup
    const r = await autocannon({ ...options, duration: scenario.duration });
    const stats = r.statusCodeStats ?? {};
    const total = Object.values(stats).reduce((s, v) => s + (v.count ?? 0), 0);
    const hit = stats[String(scenario.expect)]?.count ?? 0;
    if (total === 0 || hit !== total) {
      const seen = Object.entries(stats)
        .map(([c, v]) => `${c}x${v.count}`)
        .join(" ");
      throw new Error(`${framework}/${scenario.id}: expected 100% ${scenario.expect}, saw ${seen}`);
    }
    return r.requests.average;
  } finally {
    await stop(child);
    await sleep(settleMs);
  }
}

const results = {};
for (const scenario of scenarios) {
  const samples = Object.fromEntries(FRAMEWORKS.map((f) => [f, []]));
  let round = 0;
  // Methodology: >= minRounds; while any framework's spread > 5%, extend
  // (to maxRounds) and re-median.
  while (round < maxRounds) {
    const rot = round % FRAMEWORKS.length;
    const order = FRAMEWORKS.slice(rot).concat(FRAMEWORKS.slice(0, rot));
    process.stdout.write(`${scenario.id} round ${round + 1} [${order.join(">")}] `);
    for (const f of order) {
      const rps = await measure(f, scenario);
      samples[f].push(rps);
      process.stdout.write(`${f}=${fmt(rps)} `);
    }
    process.stdout.write("\n");
    round++;
    if (round >= minRounds && FRAMEWORKS.every((f) => spreadOf(samples[f]) <= 5)) break;
  }
  results[scenario.id] = samples;
  console.log("");
}

const regimePost = measureRegime(SMALL);
const comparison = compareRegimes(regimePre, regimePost);
reportRegimeFlip(comparison);
console.log("");

// --- report -----------------------------------------------------------------

console.log("### Table");
console.log("");
console.log(
  `| scenario | ${FRAMEWORKS.map((f) => `${f} rps`).join(" | ")} | ${others
    .map((f) => `zonix/${f}`)
    .join(" | ")} | spread% (${FRAMEWORKS.map((f) => f[0]).join("/")}) | rounds |`,
);
console.log(
  `| --- | ${FRAMEWORKS.map(() => "---:").join(" | ")} | ${others.map(() => "---:").join(" | ")} | ---: | ---: |`,
);
for (const scenario of scenarios) {
  const s = results[scenario.id];
  const z = median(s.zonix);
  let label = scenario.informational ? `${scenario.id} (informational)` : scenario.id;
  if (comparison.flip && scenario.id.startsWith("file-")) label += " **REGIME-FLIP**";
  console.log(
    `| ${label} | ${FRAMEWORKS.map((f) => fmt(median(s[f]))).join(" | ")} | ` +
      `${others.map((f) => `${(z / median(s[f])).toFixed(2)}×`).join(" | ")} | ` +
      `${FRAMEWORKS.map((f) => spreadOf(s[f]).toFixed(1)).join(" / ")} | ${s.zonix.length} |`,
  );
}
if (FRAMEWORKS.includes("zonix-cache")) {
  const field = FRAMEWORKS.filter((f) => f !== "zonix" && f !== "zonix-cache");
  console.log("");
  console.log("### Cache row (zonix-cache, labeled opt-in) vs the field");
  console.log("");
  console.log(
    `| scenario | ${field.map((f) => `zonix-cache/${f}`).join(" | ")} | zonix-cache/zonix |`,
  );
  console.log(`| --- | ${field.map(() => "---:").join(" | ")} | ---: |`);
  for (const scenario of scenarios) {
    const s = results[scenario.id];
    const c = median(s["zonix-cache"]);
    console.log(
      `| ${scenario.id} | ${field.map((f) => `${(c / median(s[f])).toFixed(2)}×`).join(" | ")} | ${(c / median(s.zonix)).toFixed(2)}× |`,
    );
  }
}
console.log("");
console.log("### Per-round values (fastify in full; zonix alongside as the rule-9 flat control)");
console.log("");
const rest = FRAMEWORKS.filter((f) => f !== "fastify" && f !== "zonix");
const fastifyIn = FRAMEWORKS.includes("fastify");
console.log(
  `| scenario | fastify rounds | fastify split | zonix rounds | ${rest.map((f) => `${f} rounds`).join(" | ")} |`,
);
console.log(`| --- | --- | --- | --- | ${rest.map(() => "---").join(" | ")} |`);
for (const scenario of scenarios) {
  const s = results[scenario.id];
  // A fast-band process sits well above the common band: 1.25x the minimum is
  // far beyond the ~5% noise floor and well under the ~1.55x mode gap.
  const fastifyRounds = fastifyIn ? s.fastify : [];
  const floor = fastifyIn ? Math.min(...fastifyRounds) * 1.25 : Infinity;
  const fast = fastifyRounds.filter((x) => x > floor).length;
  const split = !fastifyIn
    ? "-"
    : fast === 0
      ? "unimodal"
      : `**BIMODAL: ${fast} fast / ${fastifyRounds.length - fast} common**`;
  const mark = (xs) => xs.map((x) => (x > floor ? `**${fmt(x)}**` : fmt(x))).join(", ");
  console.log(
    `| ${scenario.id} | ${fastifyIn ? mark(fastifyRounds) : "-"} | ${split} | ${s.zonix.map(fmt).join(", ")} | ${rest.map((f) => s[f].map(fmt).join(", ")).join(" | ")} |`,
  );
}
console.log("");
console.log(`regime pre:  ${formatRegime(regimePre)}`);
console.log(`regime post: ${formatRegime(regimePost)} -> ${comparison.stamp}`);
console.log(formatFingerprint(regimePre.fingerprint));
console.log(
  `node ${process.version} · container cpus=${process.env.BENCH_CONTAINER_CPUS ?? "?"} · ` +
    `rotating order · >=${minRounds} rounds (max ${maxRounds}) · 1 warmup (2s) + 5s measured per process · median`,
);
