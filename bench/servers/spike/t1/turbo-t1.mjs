// T-1 — the thinnest END-TO-END Turbo path, per the Session 8 sharpened spec.
//
// What is REAL here (the costs T-0's spike skipped, now in the measured path):
//   1. Request-line + header PARSING with limits enforced: token-validated
//      method, printable-validated target, exact version match, per-header
//      colon split with the no-whitespace-before-colon rule, token-validated
//      names, header count/size caps, strict Content-Length digits,
//      duplicate-CL -> 400, Transfer-Encoding -> 501. Terminator-scan-only
//      parsing was spike-only and is gone.
//   2. The HEAD-OF-LINE ordering queue, active even at depth 1: every request
//      allocates a slot; every response is emitted only when every earlier
//      slot on the connection has completed. Corking is opportunistic (ready
//      neighbours coalesce into one write) and never waits.
//   3. The documented zonix `res` subset the routes need: `statusCode`,
//      chainable `status()` with the same range validation, `set()`, and
//      `json()` with per-request serialization and header build. No static
//      response buffers — the T-0 cheat is exactly what T-1 removes. The one
//      cached thing is the Date string (per-second), which node:http itself
//      also caches.
//   4. Dispatch through a method+path map (zonix's own static-route fast
//      path), 404 on miss, sync-throw -> 500 + close.
//   5. Framing: Content-Length bodies are counted and drained so keep-alive
//      survives a POST; in-flight pipelined requests cap at 8 (socket pauses);
//      a parse error after in-flight requests lets them finish IN ORDER, then
//      writes the error and closes — bytes after a fatal are never interpreted.
//
// What is deliberately NOT here (post-D7 hardening, per TURBO.md): chunked
// bodies, trailers, timeouts/timing wheel, the full smuggling suite, fuzz.
// T-1 exists to answer one question first: does the margin survive the shim?
import net from "node:net";

const PORT = Number(process.env.PORT || 3114);

// --- limits (TURBO.md table, the subset T-1 enforces) ------------------------
const HEAD_MAX = 16384; // total header block
const LINE_MAX = 8192; // request line / single header line
const HEADERS_MAX = 100;
const PIPELINE_MAX = 8; // in-flight requests per connection

// --- shared constants --------------------------------------------------------
const CRLF2 = Buffer.from("\r\n\r\n");
const CRLF = Buffer.from("\r\n");
const STATUS = {
  200: "OK",
  404: "Not Found",
  500: "Internal Server Error",
};

let DATE = new Date().toUTCString();
setInterval(() => {
  DATE = new Date().toUTCString();
}, 1000).unref();

const fatalResponse = (status, reason) =>
  Buffer.from(`HTTP/1.1 ${status} ${reason}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
const RESP_400 = fatalResponse(400, "Bad Request");
const RESP_414 = fatalResponse(414, "URI Too Long");
const RESP_431 = fatalResponse(431, "Request Header Fields Too Large");
const RESP_501 = fatalResponse(501, "Not Implemented");

// --- byte classifiers (linear, no regex, per decision 11) --------------------
/** RFC 7230 token byte. */
function isTokenByte(c) {
  if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return true;
  return (
    c === 0x21 ||
    (c >= 0x23 && c <= 0x27) ||
    c === 0x2a ||
    c === 0x2b ||
    c === 0x2d ||
    c === 0x2e ||
    c === 0x5e ||
    c === 0x5f ||
    c === 0x60 ||
    c === 0x7c ||
    c === 0x7e
  );
}

/** Case-insensitive compare of buf[start,end) against a lowercase latin1 string. */
function nameEquals(buf, start, end, lower) {
  if (end - start !== lower.length) return false;
  for (let i = 0; i < lower.length; i++) {
    let c = buf[start + i];
    if (c >= 0x41 && c <= 0x5a) c += 32;
    if (c !== lower.charCodeAt(i)) return false;
  }
  return true;
}

/** Case-insensitive compare of an OWS-trimmed value span against a lowercase string. */
function valueEquals(buf, start, end, lower) {
  return nameEquals(buf, start, end, lower);
}

// --- request shim ------------------------------------------------------------
// Lazy headers per decision 1: the parse validated and located every header,
// but no name/value string exists until something reads `req.headers`.
class TReq {
  constructor(method, url, buf, flat) {
    this.method = method;
    this.url = url;
    this.httpVersion = "1.1";
    this._buf = buf;
    this._flat = flat;
    this._headers = null;
  }

  get headers() {
    if (this._headers === null) {
      const out = {};
      const flat = this._flat;
      const buf = this._buf;
      for (let i = 0; i < flat.length; i += 4) {
        const name = buf.toString("latin1", flat[i], flat[i + 1]).toLowerCase();
        const value = buf.toString("latin1", flat[i + 2], flat[i + 3]);
        out[name] = out[name] === undefined ? value : out[name] + ", " + value;
      }
      this._headers = out;
    }
    return this._headers;
  }
}

// --- response shim: the documented zonix subset ------------------------------
class TRes {
  constructor(conn, slot) {
    this._conn = conn;
    this._slot = slot;
    this.statusCode = 200;
    this._headers = null; // lazily created, only when set() is used
  }

  /** Chainable, with zonix's documented validation. */
  status(code) {
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new RangeError(`res.status() expects an integer between 100 and 599, received ${code}`);
    }
    this.statusCode = code;
    return this;
  }

  set(field, value) {
    if (this._headers === null) this._headers = [];
    this._headers.push([field, String(value)]);
    return this;
  }

  /** Serialize, build the head, complete the slot. Per-request, no caching. */
  json(data) {
    const slot = this._slot;
    if (slot.done) return;
    const body = JSON.stringify(data === undefined ? null : data);
    let head = `HTTP/1.1 ${this.statusCode} ${STATUS[this.statusCode] ?? "OK"}\r\n`;
    let hasType = false;
    if (this._headers !== null) {
      for (const [field, value] of this._headers) {
        head += `${field}: ${value}\r\n`;
        if (field.length === 12 && field.toLowerCase() === "content-type") hasType = true;
      }
    }
    if (!hasType) head += "content-type: application/json; charset=utf-8\r\n";
    head += `content-length: ${Buffer.byteLength(body)}\r\ndate: ${DATE}\r\n`;
    head += slot.close
      ? "connection: close\r\n\r\n"
      : "connection: keep-alive\r\nkeep-alive: timeout=5\r\n\r\n";
    slot.buf = Buffer.from(head + body);
    slot.done = true;
    this._conn.flush();
  }
}

// --- routes ------------------------------------------------------------------
// The two bench brackets plus /delay, which exists for the gauntlet's HOL
// ordering proof and is never touched by the bench.
const ROUTES = new Map();
ROUTES.set("GET /", (req, res) => {
  res.json({ hello: "world" });
});
ROUTES.set("GET /echo", (req, res) => {
  setImmediate(() => res.json({ path: req.url }));
});
ROUTES.set("GET /delay", (req, res) => {
  const q = req.url.indexOf("?ms=");
  const ms = q === -1 ? 0 : Number(req.url.slice(q + 4)) || 0;
  setTimeout(() => res.json({ delayed: ms }), ms);
});

// --- connection --------------------------------------------------------------
class Connection {
  constructor(sock) {
    this.sock = sock;
    this.pend = null; // unconsumed bytes
    this.bodySkip = 0; // Content-Length bytes still to drain
    this.slots = []; // head-of-line queue
    this.fatal = null; // pending fatal response, written after the queue drains
    this.dead = false; // no further bytes are interpreted
    this.pausedPipeline = false;
    this.pausedWrite = false;

    sock.setNoDelay(true);
    sock.on("data", (chunk) => this.onData(chunk));
    sock.on("error", () => sock.destroy());
    sock.on("drain", () => {
      this.pausedWrite = false;
      this.maybeResume();
    });
  }

  onData(chunk) {
    if (this.dead) return;
    let buf = this.pend === null ? chunk : Buffer.concat([this.pend, chunk]);
    this.pend = null;
    let off = 0;

    for (;;) {
      // Drain a declared body before looking for the next head.
      if (this.bodySkip > 0) {
        const take = Math.min(this.bodySkip, buf.length - off);
        this.bodySkip -= take;
        off += take;
        if (this.bodySkip > 0) return; // consumed the whole chunk
      }
      const idx = buf.indexOf(CRLF2, off);
      if (idx === -1) {
        const remaining = buf.length - off;
        if (remaining > HEAD_MAX) return this.fail(RESP_431);
        if (remaining > 0) this.pend = buf.subarray(off);
        return;
      }
      if (idx - off > HEAD_MAX) return this.fail(RESP_431);

      const parsed = this.parseHead(buf, off, idx);
      if (parsed.err !== undefined) return this.fail(parsed.err);
      off = idx + 4;
      this.bodySkip = parsed.contentLength;
      this.dispatch(parsed, buf);

      if (this.dead) return; // a handler decided to close (fatal via throw)
      if (this.slots.length >= PIPELINE_MAX && !this.pausedPipeline) {
        this.pausedPipeline = true;
        this.sock.pause();
        // Whatever tail is left waits in pend for the resume.
        if (off < buf.length && this.bodySkip === 0) this.pend = buf.subarray(off);
        return;
      }
    }
  }

  /**
   * Parse one head occupying [start, headEnd). `headEnd` points at the CRLF2.
   * Returns { method, url, contentLength, close, flat } or { err: Buffer }.
   */
  parseHead(buf, start, headEnd) {
    // --- request line ---
    let lineEnd = buf.indexOf(CRLF, start);
    if (lineEnd === -1 || lineEnd > headEnd) lineEnd = headEnd;
    if (lineEnd - start > LINE_MAX) return { err: RESP_414 };

    let sp1 = -1;
    for (let i = start; i < lineEnd; i++) {
      if (buf[i] === 0x20) {
        sp1 = i;
        break;
      }
      if (!isTokenByte(buf[i]) || i - start >= 16) return { err: RESP_400 };
    }
    if (sp1 === -1 || sp1 === start) return { err: RESP_400 };

    let sp2 = -1;
    for (let i = sp1 + 1; i < lineEnd; i++) {
      const c = buf[i];
      if (c === 0x20) {
        sp2 = i;
        break;
      }
      if (c < 0x21 || c === 0x7f) return { err: RESP_400 }; // controls in target
    }
    if (sp2 === -1 || sp2 === sp1 + 1) return { err: RESP_400 };

    // Version: exactly HTTP/1.1 or HTTP/1.0.
    const verLen = lineEnd - (sp2 + 1);
    if (verLen !== 8) return { err: RESP_400 };
    const v = sp2 + 1;
    if (
      buf[v] !== 0x48 ||
      buf[v + 1] !== 0x54 ||
      buf[v + 2] !== 0x54 ||
      buf[v + 3] !== 0x50 ||
      buf[v + 4] !== 0x2f ||
      buf[v + 5] !== 0x31 ||
      buf[v + 6] !== 0x2e ||
      (buf[v + 7] !== 0x31 && buf[v + 7] !== 0x30)
    ) {
      return { err: RESP_400 };
    }
    const http10 = buf[v + 7] === 0x30;

    // --- headers ---
    const flat = [];
    let contentLength = 0;
    let sawContentLength = false;
    let close = http10; // 1.0 defaults to close
    let count = 0;
    let pos = lineEnd + 2;
    const blockEnd = headEnd + 2; // past the CRLF ending the LAST header line

    while (pos < blockEnd) {
      let hEnd = buf.indexOf(CRLF, pos);
      if (hEnd === -1 || hEnd > headEnd) hEnd = headEnd;
      if (hEnd === pos) break; // the empty line
      if (hEnd - pos > LINE_MAX) return { err: RESP_431 };
      if (++count > HEADERS_MAX) return { err: RESP_431 };

      let colon = -1;
      for (let i = pos; i < hEnd; i++) {
        const c = buf[i];
        if (c === 0x3a) {
          colon = i;
          break;
        }
        if (!isTokenByte(c)) return { err: RESP_400 }; // includes SP/HTAB before colon
      }
      if (colon === -1 || colon === pos) return { err: RESP_400 };

      let vs = colon + 1;
      while (vs < hEnd && (buf[vs] === 0x20 || buf[vs] === 0x09)) vs++;
      let ve = hEnd;
      while (ve > vs && (buf[ve - 1] === 0x20 || buf[ve - 1] === 0x09)) ve--;

      flat.push(pos, colon, vs, ve);

      const nameLen = colon - pos;
      if (nameLen === 14 && nameEquals(buf, pos, colon, "content-length")) {
        if (sawContentLength) return { err: RESP_400 }; // duplicate CL
        sawContentLength = true;
        if (ve === vs || ve - vs > 15) return { err: RESP_400 };
        let n = 0;
        for (let i = vs; i < ve; i++) {
          const d = buf[i];
          if (d < 0x30 || d > 0x39) return { err: RESP_400 }; // digits only
          n = n * 10 + (d - 0x30);
        }
        contentLength = n;
      } else if (nameLen === 17 && nameEquals(buf, pos, colon, "transfer-encoding")) {
        return { err: RESP_501 };
      } else if (nameLen === 10 && nameEquals(buf, pos, colon, "connection")) {
        if (valueEquals(buf, vs, ve, "close")) close = true;
        else if (valueEquals(buf, vs, ve, "keep-alive")) close = false;
      }

      pos = hEnd + 2;
    }

    const method = buf.toString("latin1", start, sp1);
    const url = buf.toString("latin1", sp1 + 1, sp2);
    return { method, url, contentLength, close, flat, buf };
  }

  dispatch(parsed, buf) {
    const { method, url, close, flat } = parsed;
    const q = url.indexOf("?");
    const path = q === -1 ? url : url.slice(0, q);
    const handler = ROUTES.get(`${method} ${path}`);

    const slot = { done: false, buf: null, close };
    this.slots.push(slot);

    const req = new TReq(method, url, buf, flat);
    const res = new TRes(this, slot);

    if (handler === undefined) {
      res.statusCode = 404;
      res.json({ error: `Cannot ${method} ${path}` });
      return;
    }
    try {
      handler(req, res);
    } catch {
      if (!slot.done) {
        slot.close = true;
        res.statusCode = 500;
        res.json({ error: "Internal Server Error" });
      }
    }
  }

  /** Emit every completed slot at the head of the queue, in order. */
  flush() {
    const q = this.slots;
    let n = 0;
    while (n < q.length && q[n].done) n++;
    if (n === 0) return;

    const ready = q.splice(0, n);
    let out;
    if (n === 1) {
      out = ready[0].buf;
    } else {
      // Opportunistic corking: neighbours that are ready NOW share one write.
      // Nothing is ever held back waiting for a friend.
      out = Buffer.concat(ready.map((s) => s.buf));
    }
    const mustClose = ready.some((s) => s.close);
    const ok = this.sock.write(out);

    if (mustClose) {
      this.dead = true;
      this.sock.end();
      return;
    }
    if (this.fatal !== null && q.length === 0) {
      // A parse error arrived while responses were in flight; they have now
      // gone out in order, and nothing after the bad bytes was interpreted.
      this.dead = true;
      this.sock.end(this.fatal);
      return;
    }
    if (!ok) this.pausedWrite = true;
    this.maybeResume();
  }

  maybeResume() {
    if (this.dead || this.pausedWrite) return;
    if (this.pausedPipeline && this.slots.length < PIPELINE_MAX) {
      this.pausedPipeline = false;
      const tail = this.pend;
      this.pend = null;
      this.sock.resume();
      if (tail !== null) this.onData(tail);
    }
  }

  /** Parse-level failure. Never interprets another byte from this socket. */
  fail(resp) {
    this.pend = null;
    if (this.slots.length > 0) {
      this.fatal = resp; // finish in-flight responses first, in order
      this.sock.pause();
      return;
    }
    this.dead = true;
    this.sock.end(resp);
  }
}

const srv = net.createServer((sock) => new Connection(sock));
srv.listen(PORT, () => console.log("READY"));
