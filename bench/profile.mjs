// CPU-profile the zonix bench server under load.
//
//   npm run profile                      profile the hello scenario
//   npm run profile -- --scenario=chain  any scenario id from run.mjs
//
// Writes a V8 .cpuprofile to bench/.profile/ (open it in https://speedscope.app
// or Chrome DevTools) and prints the top functions by self time, so the
// "flamegraph before guessing" rule can be satisfied from the terminal.
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCENARIOS = {
  hello: { path: "/", connections: 100, pipelining: 10 },
  param: { path: "/users/42", connections: 100, pipelining: 10 },
  chain: { path: "/chain", connections: 100, pipelining: 10 },
  notfound: { path: "/no-such-route", connections: 100, pipelining: 10 },
  "file-1kb": { path: "/file/small", connections: 100, pipelining: 10 },
  "file-1mb": { path: "/file/large", connections: 50, pipelining: 1 },
};

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const name = args.get("scenario") ?? "hello";
const scenario = SCENARIOS[name];
if (!scenario) {
  console.error(`Unknown scenario "${name}". Try: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}

const duration = Number(args.get("duration") ?? 10);
const root = fileURLToPath(new URL("..", import.meta.url));
const profileDir = fileURLToPath(new URL("./.profile/", import.meta.url));

rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });

const port = 3011;
const child = spawn(
  process.execPath,
  ["--cpu-prof", `--cpu-prof-dir=${profileDir}`, "bench/servers/zonix.js"],
  {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  },
);

await new Promise((resolve, reject) => {
  child.once("message", (m) => (m === "ready" ? resolve() : null));
  child.once("error", reject);
});

console.log(`profiling "${name}" for ${duration}s...`);
// A short warmup first, so the profile is of optimized code, not of the JIT
// still tiering up.
await autocannon({ url: `http://127.0.0.1:${port}${scenario.path}`, ...scenario, duration: 3 });
const result = await autocannon({
  url: `http://127.0.0.1:${port}${scenario.path}`,
  ...scenario,
  duration,
});
console.log(`${Math.round(result.requests.average).toLocaleString("en-US")} rps during profiling`);

await new Promise((resolve) => {
  child.once("exit", resolve);
  child.send("shutdown", () => {});
});

// --- analysis ---------------------------------------------------------------

const file = readdirSync(profileDir).find((f) => f.endsWith(".cpuprofile"));
if (!file) {
  console.error("No .cpuprofile was written.");
  process.exit(1);
}
const path = profileDir + file;
const profile = JSON.parse(readFileSync(path, "utf8"));

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const selfTime = new Map();

for (let i = 0; i < profile.samples.length; i++) {
  const node = byId.get(profile.samples[i]);
  if (!node) continue;
  const delta = profile.timeDeltas[i] ?? 0;
  const frame = node.callFrame;
  const where = frame.url ? frame.url.replace(/^.*[\\/]/, "") : "";
  const key = `${frame.functionName || "(anonymous)"}${where ? ` @ ${where}:${frame.lineNumber + 1}` : ""}`;
  selfTime.set(key, (selfTime.get(key) ?? 0) + delta);
}

const total = [...selfTime.values()].reduce((a, b) => a + b, 0);
const ranked = [...selfTime.entries()].sort((a, b) => b[1] - a[1]);

console.log("");
console.log("Top 25 functions by self time:");
console.log("");
console.log("|    % | Function |");
console.log("| ---: | -------- |");
for (const [key, time] of ranked.slice(0, 25)) {
  console.log(`| ${((time / total) * 100).toFixed(2)} | ${key} |`);
}

const zonixTime = ranked
  .filter(([key]) => key.includes("index.js") || key.includes("dist"))
  .reduce((sum, [, t]) => sum + t, 0);
console.log("");
console.log(`zonix's own frames: ${((zonixTime / total) * 100).toFixed(1)}% of self time`);
console.log(`profile written to ${path}`);
