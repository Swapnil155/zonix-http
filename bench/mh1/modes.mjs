// MH-1 mode mechanism: run minimal Fastify (6 routes) under --trace-opt
// --trace-deopt --cpu-prof in fresh processes until one lands in the FAST mode
// and one in the COMMON mode, plus one zonix process under the same flags, then
// print, per process: the rps, the optimization tier each hot function reached
// (Maglev / Turbofan), every deopt grouped by function + reason, and the top
// self-time frames — and a diff of the fast vs common process at the shared
// node:http call sites.
//
//   node bench/container.mjs --no-build -- node bench/mh1/modes.mjs --max=14
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const MAX = Number(args.get("max") ?? 14);
const SCALE = args.get("scale") ?? "6";
const FAST_FACTOR = 1.3;
let port = 5600;
const fmt = (n) => Math.round(n).toLocaleString("en-US");

function runOne(kind) {
  return new Promise((resolve, reject) => {
    const bound = ++port;
    const dir = mkdtempSync(join(tmpdir(), "mh1-"));
    const script = kind === "zonix" ? "bench/servers/zonix.js" : "bench/mh1/variant.js";
    const child = spawn(
      process.execPath,
      ["--trace-opt", "--trace-deopt", "--cpu-prof", `--cpu-prof-dir=${dir}`, script],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(bound),
          FIXED: "",
          SCALE,
          BENCH_ROUTES: kind === "zonix" ? SCALE : "",
        },
        stdio: ["ignore", "pipe", "inherit", "ipc"],
      },
    );
    let trace = "";
    child.stdout.on("data", (d) => {
      if (trace.length < 64 * 1024 * 1024) trace += d;
    });
    const timer = setTimeout(() => reject(new Error("never ready")), 30000);
    child.once("message", async () => {
      clearTimeout(timer);
      const load = {
        url: `http://127.0.0.1:${bound}`,
        connections: 100,
        pipelining: 10,
        requests: [{ path: "/api/v1/res0/12345" }],
      };
      try {
        await autocannon({ ...load, duration: 2 });
        const r = await autocannon({ ...load, duration: 4 });
        await new Promise((done) => {
          child.once("exit", done);
          child.send("shutdown", () => {});
          setTimeout(() => child.kill("SIGKILL"), 5000).unref();
        });
        const file = readdirSync(dir).find((f) => f.endsWith(".cpuprofile"));
        const profile = file ? JSON.parse(readFileSync(join(dir, file), "utf8")) : null;
        rmSync(dir, { recursive: true, force: true });
        resolve({ kind, rps: r.requests.average, trace, profile });
      } catch (err) {
        reject(err);
      }
    });
  });
}

// --- analysis helpers ---------------------------------------------------------

function selfTimes(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    if (!node) continue;
    const delta = profile.timeDeltas[i] ?? 0;
    const f = node.callFrame;
    const where = f.url ? f.url.replace(/^.*[\\/]/, "") : "";
    const key = `${f.functionName || "(anonymous)"}${where ? ` @ ${where}:${f.lineNumber + 1}` : ""}`;
    self.set(key, (self.get(key) ?? 0) + delta);
    total += delta;
  }
  const pct = new Map();
  for (const [k, v] of self) pct.set(k, (v / total) * 100);
  return pct;
}

function parseTrace(trace) {
  // --trace-opt: "[completed optimizing 0x... <JSFunction name (sfi = 0x...)> (target TURBOFAN)]"
  //              "[completed compiling 0x... <JSFunction name ...> (target MAGLEV) ...]"
  // --trace-deopt: "[bailout (kind: deopt-eager, reason: ...): begin. deoptimizing 0x..., <JSFunction name (sfi ...)>, ..."
  const tiers = new Map(); // fn -> Set of tiers reached
  const deopts = new Map(); // "fn | reason" -> count
  const fnRe = /<JSFunction ([^ (>]*)/;
  for (const line of trace.split("\n")) {
    if (line.startsWith("[completed ")) {
      const fn = fnRe.exec(line)?.[1] || "(anonymous)";
      const tier = /\(target ([A-Z]+)\)/.exec(line)?.[1] ?? "?";
      if (!tiers.has(fn)) tiers.set(fn, new Set());
      tiers.get(fn).add(tier);
    } else if (line.startsWith("[bailout ")) {
      const fn = fnRe.exec(line)?.[1] || "(anonymous)";
      const reason = /reason: ([^)]*)\)/.exec(line)?.[1] ?? "?";
      const kind = /kind: ([^,]*),/.exec(line)?.[1] ?? "?";
      const key = `${fn} | ${kind} | ${reason}`;
      deopts.set(key, (deopts.get(key) ?? 0) + 1);
    }
  }
  return { tiers, deopts };
}

const SHARED_SITES = [
  "parserOnIncoming",
  "parserOnHeadersComplete",
  "parserOnMessageComplete",
  "parserOnBody",
  "_addHeaderLine",
  "resOnFinish",
  "_storeHeader",
  "_send",
  "writeHead",
  "end",
  "_writeRaw",
  "writevGeneric",
  "writeGeneric",
  "onStreamRead",
  "emit",
  "nextTick",
  "processTicksAndRejections",
  "runMicrotasks",
  "afterWrite",
  "onWriteComplete",
  "socketOnData",
  "Readable.read",
  "clearBuffer",
  "writeOrBuffer",
  "onParserExecute",
  "Socket._writeGeneric",
];

function report(p, label) {
  console.log(`\n### ${label}: ${fmt(p.rps)} rps\n`);
  const { tiers, deopts } = parseTrace(p.trace);
  const hot = p.profile ? [...selfTimes(p.profile).entries()].sort((a, b) => b[1] - a[1]) : [];
  console.log("Top 20 self-time frames:");
  for (const [k, v] of hot.slice(0, 20)) console.log(`  ${v.toFixed(2).padStart(6)}%  ${k}`);
  const totalDeopts = [...deopts.values()].reduce((a, b) => a + b, 0);
  console.log(`\nDeopts: ${totalDeopts} total; top by function|kind|reason:`);
  for (const [k, v] of [...deopts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log("\nTiers reached at shared node:http sites:");
  for (const site of SHARED_SITES) {
    const t = tiers.get(site);
    if (t) console.log(`  ${site.padEnd(28)} ${[...t].join("+")}`);
  }
  const tf = [...tiers.values()].filter((s) => s.has("TURBOFAN")).length;
  const mg = [...tiers.values()].filter((s) => s.has("MAGLEV")).length;
  console.log(`\nFunctions that reached TURBOFAN: ${tf}; MAGLEV: ${mg}`);
  return { tiers, deopts, hot: new Map(hot) };
}

// --- run ---------------------------------------------------------------------

let fast = null;
let common = null;
const seen = [];
console.log(
  `sampling minimal Fastify (${SCALE} routes) with --trace-opt --trace-deopt --cpu-prof, up to ${MAX} processes`,
);
for (let i = 1; i <= MAX && !(fast && common); i++) {
  const p = await runOne("fastify");
  seen.push(p);
  const minSoFar = Math.min(...seen.map((x) => x.rps));
  const label = p.rps >= minSoFar * FAST_FACTOR ? "FAST?" : "common?";
  console.log(`  process ${i}: ${fmt(p.rps)} rps (${label})`);
  // Reclassify everything seen so far against the current floor.
  const floor = minSoFar * FAST_FACTOR;
  fast = seen.find((x) => x.rps >= floor) ?? null;
  common = [...seen].reverse().find((x) => x.rps < floor) ?? null;
  if (seen.length < 2) fast = null; // one sample cannot be both floor and fast
  await new Promise((r) => setTimeout(r, 300));
}
const z = await runOne("zonix");
console.log(`  zonix: ${fmt(z.rps)} rps`);

if (!fast || !common) {
  console.log("\nThis session produced only one Fastify mode; no fast-vs-common diff is possible.");
  console.log(`Fastify readings: ${seen.map((x) => fmt(x.rps)).join(", ")}`);
  const lone = seen[seen.length - 1];
  report(lone, "fastify (only mode seen)");
  report(z, "zonix");
  process.exit(0);
}

const F = report(fast, "fastify FAST mode");
const C = report(common, "fastify COMMON mode");
const Z = report(z, "zonix");

console.log("\n### Diff: fast vs common (self-time share, >= 0.5pp apart)\n");
console.log("| frame | fast % | common % | zonix % |");
console.log("| --- | ---: | ---: | ---: |");
const keys = new Set([...F.hot.keys(), ...C.hot.keys()]);
const rows = [...keys]
  .map((k) => [k, F.hot.get(k) ?? 0, C.hot.get(k) ?? 0])
  .filter(([, a, b]) => Math.abs(a - b) >= 0.5)
  .sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2]));
for (const [k, a, b] of rows.slice(0, 25)) {
  const zk = [...Z.hot.keys()].find((x) => x.split(" @ ")[0] === k.split(" @ ")[0]);
  console.log(
    `| ${k} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${zk ? Z.hot.get(zk).toFixed(2) : "—"} |`,
  );
}

console.log("\n### Diff: tiers at shared sites (fast vs common vs zonix)\n");
console.log("| site | fast | common | zonix |");
console.log("| --- | --- | --- | --- |");
for (const site of SHARED_SITES) {
  const a = F.tiers.get(site),
    b = C.tiers.get(site),
    c = Z.tiers.get(site);
  if (a || b || c) {
    const s = (t) => (t ? [...t].join("+") : "—");
    console.log(`| ${site} | ${s(a)} | ${s(b)} | ${s(c)} |`);
  }
}
console.log("\n### Diff: deopts present in one mode but not the other\n");
const dk = new Set([...F.deopts.keys(), ...C.deopts.keys()]);
for (const k of dk) {
  const a = F.deopts.get(k) ?? 0,
    b = C.deopts.get(k) ?? 0;
  if ((a === 0) !== (b === 0) || Math.abs(a - b) >= 5)
    console.log(`  fast ${a}  common ${b}  ${k}`);
}
