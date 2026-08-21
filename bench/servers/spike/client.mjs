// One load-generator process. Prints rps as JSON so a driver can sum several.
// Split out of bench-paired.mjs to answer: is the single-threaded client the
// ceiling? If K clients aggregate to more than 1 client measures, it was.
import net from "node:net";
const HOST = "127.0.0.1";
const PORT = +process.env.PORT,
  CONNS = +(process.env.C || 6),
  PIPE = +(process.env.P || 1);
const WARMUP_MS = +(process.env.WARMUP || 1000),
  MEASURE_MS = +(process.env.MEASURE || 4000);
const REQ = `GET / HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nConnection: keep-alive\r\n\r\n`;

const L = await new Promise((res) => {
  const s = net.connect(PORT, HOST, () => s.write(REQ));
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

const batch = Buffer.from(REQ.repeat(PIPE));
const need = L * PIPE;
let done = 0,
  measuring = false;
const socks = [];
for (let i = 0; i < CONNS; i++) {
  const s = net.connect(PORT, HOST, () => {
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
    console.log(JSON.stringify({ rps: done / secs }));
    process.exit(0);
  }, MEASURE_MS);
}, WARMUP_MS);
