// Paired A/B kill-gate bench: raw node:http vs turbo spike, interleaved rounds.
// Load client is deliberately minimal (byte-counting, no response parsing)
// so that on a 1-core container the client tax is as small and as equal as
// possible for both servers. Fixed-length responses make byte-counting exact.
import { spawn } from "node:child_process";
import net from "node:net";

const HOST = "127.0.0.1";
const CONNS = +(process.env.C || 6),
  PIPE = +(process.env.P || 16),
  WARMUP_MS = 1000,
  MEASURE_MS = 4000,
  PAIRS = +(process.env.PAIRS || 5);
const REQ = (p) => `GET / HTTP/1.1\r\nHost: ${HOST}:${p}\r\nConnection: keep-alive\r\n\r\n`;

function startServer(file, port) {
  return new Promise((res) => {
    const proc = spawn("node", [file], { env: { ...process.env, PORT: String(port) } });
    proc.stdout.on("data", (d) => {
      if (String(d).includes("READY")) res(proc);
    });
  });
}

function probeLen(port) {
  // one request -> exact response byte length
  return new Promise((res) => {
    const s = net.connect(port, HOST, () => s.write(REQ(port)));
    let n = 0,
      t;
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

function blast(port, L) {
  return new Promise((resolve) => {
    const batch = Buffer.from(REQ(port).repeat(PIPE));
    const need = L * PIPE;
    let done = 0,
      measuring = false;
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
          if (measuring) done += PIPE;
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
      }, MEASURE_MS);
    }, WARMUP_MS);
  });
}

async function round(file, port) {
  const proc = await startServer(file, port);
  const L = await probeLen(port);
  const rps = await blast(port, L);
  proc.kill();
  await new Promise((r) => setTimeout(r, 150));
  return rps;
}

const raw = [],
  turbo = [];
for (let i = 1; i <= PAIRS; i++) {
  const a = await round("raw-http.mjs", 3101);
  const b = await round("turbo-spike.mjs", 3102);
  raw.push(a);
  turbo.push(b);
  console.log(
    `pair ${i}: raw ${a.toFixed(0)} rps | turbo ${b.toFixed(0)} rps | ratio ${(b / a).toFixed(3)}x`,
  );
}
const med = (x) => [...x].sort((p, q) => p - q)[Math.floor(x.length / 2)];
const ratios = raw.map((r, i) => turbo[i] / r);
console.log("---");
console.log(`raw    median: ${med(raw).toFixed(0)} rps`);
console.log(`turbo  median: ${med(turbo).toFixed(0)} rps`);
console.log(
  `ratio  median: ${med(ratios).toFixed(3)}x  (per-pair: ${ratios.map((r) => r.toFixed(2)).join(", ")})`,
);
console.log(
  `KILL BAR 1.30x -> ${med(ratios) >= 1.3 ? "PASSED: Turbo lives" : "FAILED: Turbo dies"}`,
);
