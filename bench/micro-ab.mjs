// Pair alternating baseline/candidate microbenchmark processes.
//
//   node bench/snapshot.mjs       # freeze current lib/ as the baseline
//   ...edit lib/...
//   node bench/micro-ab.mjs --pairs=7
//
// One implementation per process keeps the measured call site monomorphic;
// alternating the order across pairs cancels machine drift. The reported number
// is the median of the per-pair deltas, which is the statistic the "< 1% gets
// reverted" rule is adjudicated on.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const pairs = Number(args.get("pairs") ?? 7);
const iterations = args.get("iterations") ?? "200000";
const repeats = args.get("repeats") ?? "9";
const root = fileURLToPath(new URL("..", import.meta.url));

function run(impl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "bench/micro.ts",
        `--impl=${impl}`,
        `--iterations=${iterations}`,
        `--repeats=${repeats}`,
        "--json-stdout",
      ],
      { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) return reject(new Error(`${impl} exited ${code}`));
      try {
        resolve(JSON.parse(out.trim().split("\n").pop()));
      } catch (err) {
        reject(new Error(`could not parse ${impl} output: ${out}`));
      }
    });
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const perCase = new Map();

for (let i = 0; i < pairs; i++) {
  process.stdout.write(`pair ${i + 1}/${pairs} `);
  const baselineFirst = i % 2 === 0;
  const a = baselineFirst ? await run("baseline") : null;
  const b = await run("candidate");
  const a2 = baselineFirst ? a : await run("baseline");

  for (const [name, candidateRate] of Object.entries(b.results)) {
    const baselineRate = a2.results[name];
    if (baselineRate === undefined) continue;
    if (!perCase.has(name)) perCase.set(name, []);
    perCase.get(name).push((candidateRate - baselineRate) / baselineRate);
  }
  process.stdout.write("done\n");
}

const fmt = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";

console.log("");
console.log("| Case | delta (median of pairs) | range | verdict |");
console.log("| ---- | ----------------------: | ----- | ------- |");
const all = [];
for (const [name, deltas] of perCase) {
  const m = median(deltas);
  all.push(m);
  const verdict = m >= 0.01 ? "faster" : m <= -0.01 ? "SLOWER" : "noise";
  console.log(
    `| ${name} | ${fmt(m)} | ${fmt(Math.min(...deltas))}..${fmt(Math.max(...deltas))} | ${verdict} |`,
  );
}
console.log("");
console.log(`overall median ${fmt(median(all))} across ${pairs} pairs`);
