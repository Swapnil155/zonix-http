// T-0 TURBO SPIKE — kill-gate experiment per CLAUDE.md "Path to First, M4".
// A hand-rolled HTTP/1.1 server on raw net sockets. GET-only, keep-alive,
// pipelining-aware, corked writes: every complete request found in one
// 'data' event is answered with ONE socket.write of a pre-built buffer.
//
// WHAT THIS DELIBERATELY SKIPS (why production Turbo needs the design doc):
//   - full request-line/header parsing & validation (method check only)
//   - request bodies (Content-Length / chunked), so POST etc. are rejected
//   - Connection: close handling, Expect: 100-continue, TE negotiation
//   - per-socket write backpressure strategy beyond Node's internal buffering
//   - request smuggling defenses (CL/TE) — GET-only makes them moot HERE only
// Headers mirror the raw node:http baseline byte-class for fairness:
// Content-Type, Content-Length, Date (cached, 1s tick), Connection, Keep-Alive.

import net from "node:net";

const BODY = JSON.stringify({ hello: "world" });
const CRLF2 = Buffer.from("\r\n\r\n");
const MAX_PENDING = 8192; // header cap; beyond this without a terminator -> 431

function buildResp(dateStr) {
  return Buffer.from(
    "HTTP/1.1 200 OK\r\n" +
      "content-type: application/json\r\n" +
      `content-length: ${Buffer.byteLength(BODY)}\r\n` +
      `date: ${dateStr}\r\n` +
      "connection: keep-alive\r\n" +
      "keep-alive: timeout=5\r\n" +
      "\r\n" +
      BODY,
  );
}
const RESP_405 = Buffer.from(
  "HTTP/1.1 405 Method Not Allowed\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
);
const RESP_431 = Buffer.from(
  "HTTP/1.1 431 Request Header Fields Too Large\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
);

let RESP = buildResp(new Date().toUTCString());
let multiCache = [null, RESP];
setInterval(() => {
  RESP = buildResp(new Date().toUTCString());
  multiCache = [null, RESP];
}, 1000).unref();

// Corking: k responses -> one pre-concatenated buffer, cached per date-tick.
function multi(k) {
  const hit = multiCache[k];
  if (hit) return hit;
  const b = Buffer.allocUnsafe(RESP.length * k);
  for (let i = 0; i < k; i++) RESP.copy(b, i * RESP.length);
  if (k < 64) multiCache[k] = b;
  return b;
}

const G = 71,
  E = 69,
  T = 84,
  SP = 32; // 'GET '

const srv = net.createServer((sock) => {
  sock.setNoDelay(true);
  sock.pend = null;
  sock.on("error", () => sock.destroy());
  sock.on("data", (chunk) => {
    let buf = sock.pend ? Buffer.concat([sock.pend, chunk]) : chunk;
    let off = 0,
      count = 0;
    for (;;) {
      const idx = buf.indexOf(CRLF2, off);
      if (idx === -1) break;
      // request occupies [off, idx+4); validate method on its first bytes
      if (!(buf[off] === G && buf[off + 1] === E && buf[off + 2] === T && buf[off + 3] === SP)) {
        sock.end(RESP_405);
        return;
      }
      count++;
      off = idx + 4;
    }
    sock.pend = off < buf.length ? buf.subarray(off) : null;
    if (sock.pend && sock.pend.length > MAX_PENDING) {
      sock.end(RESP_431);
      return;
    }
    if (count) sock.write(multi(count));
  });
});
srv.listen(Number(process.env.PORT || 3102), () => console.log("READY"));
