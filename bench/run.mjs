// Benchmark matrix runner.
//
//   npm run bench                          full matrix, all frameworks
//   npm run bench -- --only=zonix          iterate on zonix alone
//   npm run bench -- --scenarios=hello     one scenario
//   npm run bench -- --runs=1 --quick      fast, noisy: for a smoke check only
//   npm run bench -- --json=out.json       dump raw numbers
//
// Methodology (locked by CLAUDE.md Phase 5.5 step 1): one warmup run, then N
// measured runs, reporting the MEDIAN. Same node binary for every server, one
// server process alive at a time, nothing else running.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCENARIOS = [
  // hello keeps -d 10 so its number stays comparable with the v1 README table.
  {
    id: "hello",
    path: "/",
    connections: 100,
    pipelining: 10,
    duration: 10,
    warmup: 3,
    expect: 200,
  },
  {
    id: "param",
    path: "/users/42",
    connections: 100,
    pipelining: 10,
    duration: 5,
    warmup: 2,
    expect: 200,
  },
  {
    id: "chain",
    path: "/chain",
    connections: 100,
    pipelining: 10,
    duration: 5,
    warmup: 2,
    expect: 200,
  },
  {
    id: "notfound",
    path: "/no-such-route",
    connections: 100,
    pipelining: 10,
    duration: 5,
    warmup: 2,
    // Non-2xx is the EXPECTED outcome here; the assertion exists so a stray 500
    // can never hide inside an expected-error scenario.
    expect: 404,
  },
  {
    id: "file-1kb",
    path: "/file/small",
    connections: 100,
    pipelining: 10,
    duration: 5,
    warmup: 2,
    expect: 200,
  },
  // Pipelining a 1MB body measures the kernel, not the framework: keep it at 1.
  {
    id: "file-1mb",
    path: "/file/large",
    connections: 50,
    pipelining: 1,
    duration: 5,
    warmup: 2,
    expect: 200,
  },
];

const FRAMEWORKS = [
  { id: "zonix", script: "bench/servers/zonix.js", port: 3001 },
  { id: "express", script: "bench/servers/express.js", port: 3002 },
  { id: "fastify", script: "bench/servers/fastify.js", port: 3003 },
];

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const only = args.get("only")?.split(",");
const wanted = args.get("scenarios")?.split(",");
const runs = Number(args.get("runs") ?? 3);
const quick = args.has("quick");

const frameworks = FRAMEWORKS.filter((f) => !only || only.includes(f.id));
const scenarios = SCENARIOS.filter((s) => !wanted || wanted.includes(s.id)).map((s) =>
  quick ? { ...s, duration: 2, warmup: 1 } : s,
);

const root = fileURLToPath(new URL("..", import.meta.url));

function startServer(framework) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [framework.script], {
      cwd: root,
      env: { ...process.env, PORT: String(framework.port) },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const timer = setTimeout(
      () => reject(new Error(`${framework.id} never signalled ready`)),
      20000,
    );
    child.once("message", (m) => {
      if (m === "ready") {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${framework.id} exited early with code ${code}`));
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.removeAllListeners("exit");
    child.once("exit", resolve);
    child.send("shutdown", () => {});
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000).unref();
  });
}

async function hit(url, scenario, duration) {
  const result = await autocannon({
    url,
    connections: scenario.connections,
    pipelining: scenario.pipelining,
    duration,
  });
  return result;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const results = {};

for (const framework of frameworks) {
  results[framework.id] = {};
  for (const scenario of scenarios) {
    const child = await startServer(framework);
    const url = `http://127.0.0.1:${framework.port}${scenario.path}`;
    try {
      process.stdout.write(`${framework.id}/${scenario.id}: warmup`);
      await hit(url, scenario, scenario.warmup);

      const samples = [];
      let spread = 0;
      let rps = 0;
      // Locked methodology: N measured runs, median. If the spread exceeds 5%
      // the sample is untrustworthy, so add runs (to a cap of 5) and re-median.
      const maxSamples = Math.max(runs, 5);
      for (let i = 0; i < maxSamples; i++) {
        process.stdout.write(` run${i + 1}`);
        const r = await hit(url, scenario, scenario.duration);
        samples.push(r.requests.average);

        // Every response must carry the status the scenario expects.
        const stats = r.statusCodeStats ?? {};
        const counted = Object.entries(stats).reduce((sum, [, v]) => sum + (v.count ?? 0), 0);
        const wanted = stats[String(scenario.expect)]?.count ?? 0;
        if (counted > 0 && wanted !== counted) {
          const seen = Object.entries(stats)
            .map(([code, v]) => `${code}x${v.count}`)
            .join(" ");
          throw new Error(
            `${framework.id}/${scenario.id}: expected all ${scenario.expect} responses, saw ${seen}`,
          );
        }

        rps = median(samples);
        spread = (Math.max(...samples) - Math.min(...samples)) / rps;
        if (samples.length >= runs && spread <= 0.05) break;
      }

      results[framework.id][scenario.id] = { rps, samples, spreadPct: spread * 100 };
      process.stdout.write(
        ` -> ${Math.round(rps).toLocaleString("en-US")} rps (±${(spread * 100).toFixed(1)}%)\n`,
      );
    } finally {
      await stopServer(child);
    }
  }
}

// --- report -----------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => Math.round(n).toLocaleString("en-US");

console.log("");
console.log(`| Scenario | ${frameworks.map((f) => pad(f.id, 9)).join(" | ")} |`);
console.log(`| -------- | ${frameworks.map(() => "--------:").join(" | ")} |`);
for (const scenario of scenarios) {
  const cells = frameworks.map((f) => pad(num(results[f.id][scenario.id].rps), 9));
  console.log(`| ${pad(scenario.id, 8)} | ${cells.join(" | ")} |`);
}

if (frameworks.length > 1 && results.zonix && results.fastify) {
  console.log("");
  console.log("zonix as % of fastify:");
  for (const scenario of scenarios) {
    const z = results.zonix[scenario.id].rps;
    const f = results.fastify[scenario.id].rps;
    console.log(`  ${pad(scenario.id, 10)} ${((z / f) * 100).toFixed(1)}%`);
  }
}

const noisy = Object.entries(results).flatMap(([fw, byScenario]) =>
  Object.entries(byScenario)
    .filter(([, r]) => r.spreadPct > 5)
    .map(([id, r]) => `${fw}/${id} ${r.spreadPct.toFixed(1)}%`),
);
if (noisy.length > 0) {
  console.log("");
  console.log(`Spread still > 5% after ${Math.max(runs, 5)} samples: ${noisy.join(", ")}`);
}

console.log("");
console.log(
  `node ${process.version} · >=${runs} measured runs + warmup · median · ` +
    `status asserted per scenario`,
);
console.log(
  "durations: " +
    SCENARIOS.map((s) => `${s.id} ${s.duration}s@c${s.connections}p${s.pipelining}`).join(", "),
);

const jsonPath = args.get("json");
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ node: process.version, runs, results }, null, 2));
  console.log(`raw results -> ${jsonPath}`);
}
