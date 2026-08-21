// Correctness gauntlet for the T-0 spike.
//
// CLAUDE.md records that the spike "passed a 5-test correctness gauntlet first",
// but the gauntlet itself was not delivered with the code. Re-created here so
// the spike is self-verifying: a server that answers fast but wrongly is not a
// benchmark data point, and the T-0 ratio only means something if the thing
// being measured actually speaks HTTP.
//
// Run:  node gauntlet.mjs [file.mjs]   (defaults to turbo-spike.mjs)
import { spawn } from "node:child_process";
import net from "node:net";

const FILE = process.argv[2] || "turbo-spike.mjs";
const PORT = 3199,
  HOST = "127.0.0.1";
const REQ = `GET / HTTP/1.1\r\nHost: ${HOST}\r\nConnection: keep-alive\r\n\r\n`;

const start = () =>
  new Promise((res) => {
    const p = spawn("node", [FILE], { env: { ...process.env, PORT: String(PORT) } });
    p.stdout.on("data", (d) => {
      if (String(d).includes("READY")) res(p);
    });
  });

/** Collect bytes until the socket goes quiet for `idle` ms. */
function collect(write, { idle = 150, timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const s = net.connect(PORT, HOST, () => {
      s.setNoDelay(true);
      write(s);
    });
    let out = "",
      t;
    const finish = () => {
      s.destroy();
      resolve(out);
    };
    s.on("data", (d) => {
      out += d;
      clearTimeout(t);
      t = setTimeout(finish, idle);
    });
    s.on("error", reject);
    setTimeout(finish, timeout).unref?.();
  });
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -- ${detail}`}`);
};

const proc = await start();
console.log(`gauntlet: ${FILE}`);
try {
  // 1. one request, one well-formed response
  const one = await collect((s) => s.write(REQ));
  check(
    "single request -> 200 with body",
    /^HTTP\/1\.1 200 OK\r\n/.test(one) &&
      one.endsWith('{"hello":"world"}') &&
      /content-length: 17\r\n/.test(one) &&
      /\r\n\r\n/.test(one),
    JSON.stringify(one.slice(0, 120)),
  );

  // 2. three pipelined in ONE packet -> three responses, in order
  const three = await collect((s) => s.write(REQ.repeat(3)));
  check(
    "pipelined x3 in one packet -> 3 responses",
    (three.match(/HTTP\/1\.1 200 OK/g) || []).length === 3 &&
      (three.match(/\{"hello":"world"\}/g) || []).length === 3,
    `saw ${(three.match(/HTTP\/1\.1 200/g) || []).length}`,
  );

  // 3. one request dribbled a byte at a time across many packets
  const dribbled = await collect(
    (s) => {
      let i = 0;
      const tick = () => {
        if (i < REQ.length) {
          s.write(REQ[i++]);
          setTimeout(tick, 1);
        }
      };
      tick();
    },
    { idle: 300, timeout: 5000 },
  );
  check(
    "byte-dribbled request -> exactly 1 response",
    (dribbled.match(/HTTP\/1\.1 200 OK/g) || []).length === 1 &&
      dribbled.endsWith('{"hello":"world"}'),
    JSON.stringify(dribbled.slice(0, 120)),
  );

  // 4. a method the spike does not implement -> 405, connection closed
  const bad = await collect((s) =>
    s.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n`),
  );
  check(
    "unsupported method -> 405 + close",
    /^HTTP\/1\.1 405 /.test(bad) && /connection: close/i.test(bad),
    JSON.stringify(bad.slice(0, 120)),
  );

  // 5. headers past the cap with no terminator -> 431, not unbounded buffering
  const huge = await collect((s) => s.write(`GET / HTTP/1.1\r\nX-Big: ${"a".repeat(20000)}`));
  check(
    "oversize headers -> 431 + close",
    /^HTTP\/1\.1 431 /.test(huge) && /connection: close/i.test(huge),
    JSON.stringify(huge.slice(0, 120)),
  );
} finally {
  proc.kill();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
