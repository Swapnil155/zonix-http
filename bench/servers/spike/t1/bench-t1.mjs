// T-1 paired bench — the D7 adjudication harness.
//
// Four servers (raw node:http, zonix-on-node:http, Fastify, turbo-t1), two
// handler brackets (sync hello, async echo via setImmediate), interleaved
// within every round so slow drift cancels. Ratios are computed per round and
// the MEDIAN of per-round ratios is the judged number, exactly as every paired
// instrument in this repo works.
//
// Judged cell (D7, binding): p=1, C=6, sync hello.
//   turbo/raw     >= 1.40x  AND
//   turbo/fastify >= 1.30x
// Below either bar, Turbo dies. p=16 runs as the corking bracket and is NEVER
// the judged number (Session 8).
//
// Run the committed correctness set first: node gauntlet.mjs && node smoke.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import { measureCpu, reportCpu } from "../../../regime.mjs";

const HOST = "127.0.0.1";
const CONNS = +(process.env.C || 6);
const WARMUP_MS = 1000;

const SERVERS = [
  { name: "raw", file: "raw.mjs", port: 3111 },
  { name: "zonix", file: "zonix.mjs", port: 3112 },
  { name: "fastify", file: "fastify.mjs", port: 3113 },
  { name: "turbo", file: "turbo-t1.mjs", port: 3114 },
];

const BRACKETS = [
  { name: "sync-hello", path: "/" },
  { name: "async-echo", path: "/echo" },
];

// p=1 is the judged configuration; p=16 brackets the corking benefit.
const CONFIGS = [
  { pipe: 1, rounds: +(process.env.ROUNDS || 5), measureMs: 4000, judged: true },
  { pipe: 16, rounds: 3, measureMs: 3000, judged: false },
];

const REQ = (path, port) =>
  `GET ${path} HTTP/1.1\r\nHost: ${HOST}:${port}\r\nConnection: keep-alive\r\n\r\n`;

function startServer(file, port) {
  return new Promise((res) => {
    const proc = spawn("node", [file], { env: { ...process.env, PORT: String(port) } });
    proc.stdout.on("data", (d) => {
      if (String(d).includes("READY")) res(proc);
    });
  });
}

/** One request -> exact response byte length (all responses are fixed-length). */
function probeLen(port, path) {
  return new Promise((res) => {
    const s = net.connect(port, HOST, () => s.write(REQ(path, port)));
    let n = 0;
    let t;
    s.on("data", (d) => {
      n += d.length;
      clearTimeout(t);
      t = setTimeout(() => {
        s.destroy();
        res(n);
      }, 60);
    });
  });
}

function blast(port, path, L, pipe, measureMs) {
  return new Promise((resolve) => {
    const batch = Buffer.from(REQ(path, port).repeat(pipe));
    const need = L * pipe;
    let done = 0;
    let measuring = false;
    const socks = [];
    for (let i = 0; i < CONNS; i++) {
      const s = net.connect(port, HOST, () => {
        s.setNoDelay(true);
        s.write(batch);
      });
      let got = 0;
      s.on("data", (d) => {
        got += d.length;
        while (got >= need) {
          got -= need;
          if (measuring) done += pipe;
          s.write(batch);
        }
      });
      s.on("error", () => {});
      socks.push(s);
    }
    setTimeout(() => {
      measuring = true;
      const t0 = process.hrtime.bigint();
      setTimeout(() => {
        const secs = Number(process.hrtime.bigint() - t0) / 1e9;
        socks.forEach((s) => s.destroy());
        resolve(done / secs);
      }, measureMs);
    }, WARMUP_MS);
  });
}

async function run(server, path, pipe, measureMs) {
  const proc = await startServer(server.file, server.port);
  const L = await probeLen(server.port, path);
  const rps = await blast(server.port, path, L, pipe, measureMs);
  proc.kill();
  await new Promise((r) => setTimeout(r, 150));
  return rps;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (n) => Math.round(n).toLocaleString("en-US");

// --- preflight ---------------------------------------------------------------
reportCpu(await measureCpu({ sampleMs: 700 }));
console.log(`config: C=${CONNS}, node ${process.version}\n`);

const judged = {}; // ratios from the judged cell

for (const config of CONFIGS) {
  for (const bracket of BRACKETS) {
    const results = Object.fromEntries(SERVERS.map((s) => [s.name, []]));
    console.log(
      `=== ${bracket.name}  p=${config.pipe}  (${config.rounds} rounds${config.judged ? ", JUDGED" : ""}) ===`,
    );
    for (let round = 1; round <= config.rounds; round++) {
      const line = [];
      for (const server of SERVERS) {
        const rps = await run(server, bracket.path, config.pipe, config.measureMs);
        results[server.name].push(rps);
        line.push(`${server.name} ${fmt(rps)}`);
      }
      console.log(`  round ${round}: ${line.join(" | ")}`);
    }

    const perRound = (a, b) => results[a].map((v, i) => v / results[b][i]);
    const tr = perRound("turbo", "raw");
    const tf = perRound("turbo", "fastify");
    const tz = perRound("turbo", "zonix");
    console.log(
      `  medians: raw ${fmt(median(results.raw))} | zonix ${fmt(median(results.zonix))} | ` +
        `fastify ${fmt(median(results.fastify))} | turbo ${fmt(median(results.turbo))}`,
    );
    console.log(
      `  turbo/raw ${median(tr).toFixed(3)}x (${tr.map((r) => r.toFixed(2)).join(", ")})  ` +
        `turbo/fastify ${median(tf).toFixed(3)}x (${tf.map((r) => r.toFixed(2)).join(", ")})  ` +
        `turbo/zonix ${median(tz).toFixed(3)}x`,
    );
    console.log("");

    if (config.judged && bracket.name === "sync-hello") {
      judged.vsRaw = median(tr);
      judged.vsFastify = median(tf);
      judged.vsZonix = median(tz);
      judged.pairsRaw = tr;
      judged.pairsFastify = tf;
    }
  }
}

// --- D7 verdict --------------------------------------------------------------
console.log("=== D7 VERDICT (p=1 sync-hello, shim-inclusive, paired) ===");
console.log(
  `  turbo/raw:     ${judged.vsRaw.toFixed(3)}x  (bar 1.40x)  ${judged.vsRaw >= 1.4 ? "CLEARED" : "FAILED"}`,
);
console.log(
  `  turbo/fastify: ${judged.vsFastify.toFixed(3)}x  (bar 1.30x)  ${judged.vsFastify >= 1.3 ? "CLEARED" : "FAILED"}`,
);
console.log(`  turbo/zonix:   ${judged.vsZonix.toFixed(3)}x  (informational)`);
console.log(
  judged.vsRaw >= 1.4 && judged.vsFastify >= 1.3
    ? "  BOTH BARS CLEARED -> Turbo proceeds to hardening"
    : "  BAR MISSED -> Turbo dies (D7)",
);
