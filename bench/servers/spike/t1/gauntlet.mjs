// T-1 correctness gauntlet. Run BEFORE any benchmark number is trusted
// (Session 8 standing practice: no bench artifact ships without its
// correctness tests as committed files).
//
// The T-0 gauntlet proved the spike spoke HTTP. T-1 adds the properties the
// sharpened spec demands: real parsing with limits (so malformed input gets a
// 4xx, not a hang), Content-Length framing (so keep-alive survives bodies),
// and above all the HEAD-OF-LINE ordering queue — responses in request order
// even when a later request completes first, and a parse error that arrives
// while responses are in flight lets them finish, in order, before the close.
//
// Run:  node gauntlet.mjs
import { spawn } from "node:child_process";
import net from "node:net";

const PORT = 3198;
const HOST = "127.0.0.1";
const REQ = (path) => `GET ${path} HTTP/1.1\r\nHost: ${HOST}\r\nConnection: keep-alive\r\n\r\n`;

const start = () =>
  new Promise((res) => {
    const p = spawn("node", ["turbo-t1.mjs"], { env: { ...process.env, PORT: String(PORT) } });
    p.stdout.on("data", (d) => {
      if (String(d).includes("READY")) res(p);
    });
  });

/** Open a socket, run `write`, collect bytes until quiet, report close state. */
function collect(write, { idle = 150, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const s = net.connect(PORT, HOST, () => {
      s.setNoDelay(true);
      write(s);
    });
    let out = "";
    let closed = false;
    let t;
    const finish = () => {
      s.destroy();
      resolve({ out, closed });
    };
    s.on("data", (d) => {
      out += d;
      clearTimeout(t);
      t = setTimeout(finish, idle);
    });
    s.on("end", () => {
      closed = true;
      clearTimeout(t);
      // Give any final bytes a beat, then finish.
      t = setTimeout(finish, 30);
    });
    s.on("error", reject);
    setTimeout(finish, timeout).unref?.();
  });
}

const bodies = (raw) => [...raw.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]);
const statuses = (raw) => [...raw.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1]);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -- ${detail}`}`);
};

const proc = await start();
console.log("T-1 gauntlet: turbo-t1.mjs");
try {
  // 1. single sync request: correct status, body, content-length, charset type
  const one = await collect((s) => s.write(REQ("/")));
  check(
    "sync hello: 200 + exact body + content-length",
    /^HTTP\/1\.1 200 OK\r\n/.test(one.out) &&
      one.out.endsWith('{"hello":"world"}') &&
      /content-length: 17\r\n/.test(one.out) &&
      /content-type: application\/json; charset=utf-8\r\n/.test(one.out),
    JSON.stringify(one.out.slice(0, 160)),
  );

  // 2. keep-alive: two sequential requests on one socket
  const twice = await collect(
    (s) => {
      s.write(REQ("/"));
      setTimeout(() => s.write(REQ("/")), 120);
    },
    { idle: 250 },
  );
  check(
    "keep-alive: second request on the same socket answered",
    statuses(twice.out).length === 2 && !twice.closed,
    `saw ${statuses(twice.out).length} responses, closed=${twice.closed}`,
  );

  // 3. pipelined x3 in one packet -> 3 responses
  const three = await collect((s) => s.write(REQ("/").repeat(3)));
  check(
    "pipelined x3 -> 3 in-order responses",
    statuses(three.out).length === 3 && bodies(three.out).every((b) => b === '{"hello":"world"}'),
    three.out.slice(0, 120),
  );

  // 4. THE HOL PROOF: first request is slow, later ones are instant.
  // Responses must still arrive in request order.
  const hol = await collect((s) => s.write(REQ("/delay?ms=80") + REQ("/") + REQ("/")), {
    idle: 300,
  });
  check(
    "head-of-line ordering: slow first request, responses still in order",
    JSON.stringify(bodies(hol.out)) ===
      JSON.stringify(['{"delayed":80}', '{"hello":"world"}', '{"hello":"world"}']),
    JSON.stringify(bodies(hol.out)),
  );

  // 5. async echo bracket works and reflects the parsed URL
  const echo = await collect((s) => s.write(REQ("/echo")));
  check(
    "async echo: body is the parsed path",
    echo.out.endsWith('{"path":"/echo"}'),
    JSON.stringify(echo.out.slice(-60)),
  );

  // 6. byte-dribbled request -> exactly one response
  const dribbled = await collect(
    (s) => {
      const r = REQ("/");
      let i = 0;
      const tick = () => {
        if (i < r.length) {
          s.write(r[i++]);
          setTimeout(tick, 1);
        }
      };
      tick();
    },
    { idle: 300, timeout: 6000 },
  );
  check(
    "byte-dribbled request -> exactly 1 response",
    statuses(dribbled.out).length === 1 && dribbled.out.endsWith('{"hello":"world"}'),
    JSON.stringify(dribbled.out.slice(0, 120)),
  );

  // 7. unknown path and unknown method -> 404, connection stays open
  const missing = await collect((s) =>
    s.write(REQ("/nope") + `POST / HTTP/1.1\r\nHost: x\r\n\r\n` + REQ("/")),
  );
  check(
    "404 on unknown path and method; keep-alive survives",
    JSON.stringify(statuses(missing.out)) === JSON.stringify(["404", "404", "200"]),
    JSON.stringify(statuses(missing.out)),
  );

  // 8. Content-Length framing: a POST body is drained, the next request parses
  const framed = await collect((s) =>
    s.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello` + REQ("/")),
  );
  check(
    "content-length body drained; framing survives into the next request",
    JSON.stringify(statuses(framed.out)) === JSON.stringify(["404", "200"]) &&
      framed.out.endsWith('{"hello":"world"}'),
    JSON.stringify(statuses(framed.out)),
  );

  // 9. duplicate Content-Length -> 400 + close
  const dupCl = await collect((s) =>
    s.write(`GET / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n`),
  );
  check(
    "duplicate content-length -> 400 + close",
    /^HTTP\/1\.1 400 /.test(dupCl.out) && dupCl.closed,
    JSON.stringify(dupCl.out.slice(0, 60)) + ` closed=${dupCl.closed}`,
  );

  // 10. Transfer-Encoding -> 501 + close (T-1 does not implement chunked)
  const te = await collect((s) =>
    s.write(`GET / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n`),
  );
  check(
    "transfer-encoding -> 501 + close",
    /^HTTP\/1\.1 501 /.test(te.out) && te.closed,
    JSON.stringify(te.out.slice(0, 60)),
  );

  // 11. whitespace before the colon -> 400 + close (smuggling-adjacent)
  const wsColon = await collect((s) => s.write(`GET / HTTP/1.1\r\nHost : x\r\n\r\n`));
  check(
    "space before header colon -> 400 + close",
    /^HTTP\/1\.1 400 /.test(wsColon.out) && wsColon.closed,
    JSON.stringify(wsColon.out.slice(0, 60)),
  );

  // 12. a version that is not HTTP/1.x -> 400
  const badVer = await collect((s) => s.write(`GET / HTTP/2.0\r\nHost: x\r\n\r\n`));
  check(
    "bad version -> 400 + close",
    /^HTTP\/1\.1 400 /.test(badVer.out) && badVer.closed,
    JSON.stringify(badVer.out.slice(0, 60)),
  );

  // 13. header count over the cap -> 431 + close
  const flood = await collect((s) => {
    let head = `GET / HTTP/1.1\r\nHost: x\r\n`;
    for (let i = 0; i < 120; i++) head += `X-H${i}: v\r\n`;
    s.write(head + "\r\n");
  });
  check(
    "101+ headers -> 431 + close",
    /^HTTP\/1\.1 431 /.test(flood.out) && flood.closed,
    JSON.stringify(flood.out.slice(0, 60)),
  );

  // 14. oversized head with no terminator -> 431, no unbounded buffering
  const huge = await collect((s) => s.write(`GET / HTTP/1.1\r\nX-Big: ${"a".repeat(20000)}`));
  check(
    "oversize pending head -> 431 + close",
    /^HTTP\/1\.1 431 /.test(huge.out) && huge.closed,
    JSON.stringify(huge.out.slice(0, 60)),
  );

  // 15. FATAL behind in-flight responses: the good responses finish IN ORDER,
  // then the error, then close. Bytes after the bad request are never touched.
  const fatalOrdered = await collect(
    (s) => s.write(REQ("/delay?ms=80") + `BROKEN\r\n\r\n` + REQ("/")),
    { idle: 300 },
  );
  check(
    "parse error behind an in-flight response: response first, then 4xx, then close",
    JSON.stringify(statuses(fatalOrdered.out)) === JSON.stringify(["200", "400"]) &&
      fatalOrdered.out.includes('{"delayed":80}') &&
      fatalOrdered.out.indexOf('{"delayed":80}') < fatalOrdered.out.indexOf("HTTP/1.1 400") &&
      fatalOrdered.closed,
    `statuses=${JSON.stringify(statuses(fatalOrdered.out))} closed=${fatalOrdered.closed}`,
  );

  // 16. Connection: close is honoured
  const closeReq = await collect((s) =>
    s.write(`GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
  );
  check(
    "connection: close honoured",
    /^HTTP\/1\.1 200 /.test(closeReq.out) &&
      /connection: close\r\n/.test(closeReq.out) &&
      closeReq.closed,
    `closed=${closeReq.closed}`,
  );
} finally {
  proc.kill();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
