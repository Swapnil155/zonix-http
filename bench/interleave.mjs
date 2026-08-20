// Three-way interleaved benchmark, one framework process alive at a time.
//
//   node bench/interleave.mjs --scenarios=file-1kb,file-1mb --rounds=5
//
// Built for BI-1 (CLAUDE.md rule 6, anomaly protocol). The standard matrix
// measures framework-by-framework, so a slow drift during one framework's block
// lands entirely on that framework. This rotates the order every round, so any
// drift is spread across all three and a real difference survives while an
// artefact averages out. Per-round samples are printed, not just medians —
// a collapse that is real looks different from one that is a single bad round.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCENARIOS = {
  "file-1kb": { path: "/file/small", connections: 100, pipelining: 10, duration: 5 },
  "file-1mb": { path: "/file/large", connections: 50, pipelining: 1, duration: 5 },
  hello: { path: "/", connections: 100, pipelining: 10, duration: 5 },
};

const FRAMEWORKS = ["zonix", "express", "fastify"];

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const names = (args.get("scenarios") ?? "file-1kb").split(",");
const rounds = Number(args.get("rounds") ?? 5);
const settleMs = Number(args.get("settle") ?? 750);
const root = fileURLToPath(new URL("..", import.meta.url));

let nextPort = 3400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(framework, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`bench/servers/${framework}.js`], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
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
  const child = await start(framework, port);
  try {
    const url = `http://127.0.0.1:${port}${scenario.path}`;
    await autocannon({ url, ...scenario, duration: 2 });
    const r = await autocannon({ url, ...scenario, duration: scenario.duration });
    const stats = r.statusCodeStats ?? {};
    const total = Object.values(stats).reduce((s, v) => s + (v.count ?? 0), 0);
    const ok = stats["200"]?.count ?? 0;
    if (total > 0 && ok !== total) {
      throw new Error(
        `${framework}: expected all 200s, saw ${Object.entries(stats)
          .map(([c, v]) => `${c}x${v.count}`)
          .join(" ")}`,
      );
    }
    return r.requests.average;
  } finally {
    await stop(child);
    await sleep(settleMs);
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n) => Math.round(n).toLocaleString("en-US");

const out = {};

for (const name of names) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`Unknown scenario ${name}`);
    process.exit(1);
  }
  const samples = Object.fromEntries(FRAMEWORKS.map((f) => [f, []]));

  for (let round = 0; round < rounds; round++) {
    // Rotate who goes first so ordering cannot favour any one framework.
    const order = FRAMEWORKS.slice(round % 3).concat(FRAMEWORKS.slice(0, round % 3));
    process.stdout.write(`${name} round ${round + 1}/${rounds} [${order.join(">")}] `);
    for (const framework of order) {
      const rps = await measure(framework, scenario);
      samples[framework].push(rps);
      process.stdout.write(`${framework}=${fmt(rps)} `);
    }
    process.stdout.write("\n");
  }

  out[name] = samples;

  console.log("");
  console.log(`| ${name} | median | min | max | spread | samples |`);
  console.log("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const framework of FRAMEWORKS) {
    const xs = samples[framework];
    const m = median(xs);
    const spread = ((Math.max(...xs) - Math.min(...xs)) / m) * 100;
    console.log(
      `| ${framework} | ${fmt(m)} | ${fmt(Math.min(...xs))} | ${fmt(Math.max(...xs))} | ` +
        `${spread.toFixed(1)}% | ${xs.map(fmt).join(", ")} |`,
    );
  }
  const z = median(samples.zonix);
  console.log("");
  console.log(
    `zonix vs express ${(z / median(samples.express)).toFixed(2)}x · ` +
      `vs fastify ${(z / median(samples.fastify)).toFixed(2)}x`,
  );
  console.log("");
}

const jsonPath = args.get("json");
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ node: process.version, rounds, out }, null, 2));
  console.log(`raw -> ${jsonPath}`);
}
