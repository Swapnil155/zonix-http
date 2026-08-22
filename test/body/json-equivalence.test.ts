/**
 * ECHO-1 guards (performance rule 3): parseJSON's single-chunk fast path and
 * its multi-chunk path must put identical bytes on the wire, and the byte
 * limit must hold to the byte however the body arrives — one write, dribbled
 * bytes, or chunked transfer-encoding with no Content-Length to pre-check.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { describe, test } from "node:test";
import { ErrorCode, parseJSON, type ZonixError } from "../../lib/index.js";
import { makeApp, start } from "../helpers/make-app.js";
import { trapUnhandledRejections } from "../helpers/tripwire.js";

function app(limit: number) {
  const a = makeApp();
  a.post("/echo", parseJSON({ limit }), (req, res) => res.json(req.body));
  a.handleErr((err, _req, res) => {
    if (res.headersSent) return;
    res.status(err.status ?? 500).json({ code: err.code });
  });
  return a;
}

/** Send pre-split pieces over one socket with a pause between them; return the raw response. */
function rawPost(
  port: number,
  head: string,
  pieces: Array<string | Buffer>,
  gapMs = 5,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", async () => {
      socket.write(head);
      for (const piece of pieces) {
        socket.write(piece);
        await new Promise((r) => setTimeout(r, gapMs));
      }
    });
    let out = "";
    socket.setEncoding("utf8");
    socket.on("data", (d) => (out += d));
    socket.on("end", () => resolve(out));
    socket.on("close", () => resolve(out));
    socket.on("error", reject);
  });
}

const stripDate = (s: string) => s.replace(/^Date: .*\r\n/m, "");

const BODY = JSON.stringify({ id: 12345, name: "Ada Lovelace ☃", tags: ["a", "b"], ok: true });
const LEN = Buffer.byteLength(BODY);

function clHead(length: number): string {
  return (
    `POST /echo HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\n` +
    `Content-Length: ${length}\r\nConnection: close\r\n\r\n`
  );
}
const CHUNKED_HEAD =
  "POST /echo HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\n" +
  "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
const chunk = (b: Buffer | string) => {
  const buf = Buffer.from(b);
  return Buffer.concat([Buffer.from(`${buf.length.toString(16)}\r\n`), buf, Buffer.from("\r\n")]);
};
const LAST = "0\r\n\r\n";

describe("parseJSON: single-chunk vs multi-chunk equivalence", () => {
  test("one write, dribbled bytes, and chunked encoding produce identical responses", async () => {
    const a = app(1024);
    const running = await start(a);
    const port = running.port;
    try {
      const bytes = Buffer.from(BODY);
      const one = await rawPost(port, clHead(LEN), [bytes]);
      // Split inside the multi-byte snowman so no piece is valid UTF-8 alone.
      const cut = BODY.indexOf("☃");
      const at = Buffer.byteLength(BODY.slice(0, cut)) + 1;
      const dribbled = await rawPost(port, clHead(LEN), [
        bytes.subarray(0, 3),
        bytes.subarray(3, at),
        bytes.subarray(at, at + 1),
        bytes.subarray(at + 1),
      ]);
      const chunked = await rawPost(port, CHUNKED_HEAD, [
        chunk(bytes.subarray(0, at)),
        chunk(bytes.subarray(at)),
        LAST,
      ]);
      assert.match(one, /^HTTP\/1\.1 200 /);
      assert.ok(one.endsWith(BODY), "echoes the body byte-for-byte");
      assert.equal(stripDate(dribbled), stripDate(one));
      assert.equal(stripDate(chunked), stripDate(one));
    } finally {
      await running.close();
    }
  });

  test("a UTF-8 BOM is stripped whether it arrives whole or split across chunks", async () => {
    const a = app(1024);
    const running = await start(a);
    const port = running.port;
    try {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const bytes = Buffer.concat([bom, Buffer.from(BODY)]);
      const whole = await rawPost(port, clHead(bytes.length), [bytes]);
      const split = await rawPost(port, clHead(bytes.length), [
        bytes.subarray(0, 2),
        bytes.subarray(2),
      ]);
      assert.ok(whole.endsWith(BODY));
      assert.equal(stripDate(split), stripDate(whole));
    } finally {
      await running.close();
    }
  });
});

describe("parseJSON: the byte limit holds however the body arrives", () => {
  test("chunked body exactly at the limit is accepted; one byte over is a 413 that the client receives", async () => {
    const a = app(LEN);
    const running = await start(a);
    const port = running.port;
    try {
      const ok = await rawPost(port, CHUNKED_HEAD, [
        chunk(BODY.slice(0, 7)),
        chunk(BODY.slice(7)),
        LAST,
      ]);
      assert.match(ok, /^HTTP\/1\.1 200 /);

      // Same bytes plus one trailing space: still valid JSON, one byte over.
      const over = await rawPost(port, CHUNKED_HEAD, [
        chunk(BODY.slice(0, 7)),
        chunk(BODY.slice(7)),
        chunk(" "),
        LAST,
      ]);
      assert.match(over, /^HTTP\/1\.1 413 /);
      assert.match(over, /"code":"ERR_ZONIX_PAYLOAD_TOO_LARGE"/);
      assert.match(over, /Connection: close/i);
    } finally {
      await running.close();
    }
  });

  test("dribbled Content-Length body that overflows mid-stream is a 413, not a reset", async () => {
    const a = app(16);
    const running = await start(a);
    const port = running.port;
    try {
      const big = Buffer.from(JSON.stringify({ a: "x".repeat(64) }));
      const res = await rawPost(port, clHead(big.length), [
        big.subarray(0, 8),
        big.subarray(8, 24),
        big.subarray(24),
      ]);
      assert.match(res, /^HTTP\/1\.1 413 /);
    } finally {
      await running.close();
    }
  });

  test("a client that disconnects mid-body reaches handleErr tagged as a disconnect; nothing escapes", async () => {
    const a = makeApp();
    let seen: ZonixError | undefined;
    const saw = new Promise<void>((resolve) => {
      a.handleErr((err) => {
        seen = err;
        resolve();
      });
    });
    a.post("/echo", parseJSON({ limit: 1024 }), (req, res) => res.json(req.body));
    const trap = trapUnhandledRejections();
    const running = await start(a);
    const port = running.port;
    try {
      await new Promise<void>((resolve) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.write(clHead(1000) + '{"half":');
          setTimeout(() => socket.destroy(), 20);
        });
        socket.on("close", () => resolve());
      });
      await saw;
      assert.equal(seen?.clientDisconnect, true);
      // A reset surfaces as ECONNRESET on the stream's "error"; a quiet close
      // as ERR_STREAM_PREMATURE_CLOSE. Both are disconnects, neither is a 413.
      assert.ok(
        seen?.code === "ECONNRESET" || seen?.code === "ERR_STREAM_PREMATURE_CLOSE",
        `unexpected code ${seen?.code}`,
      );
      assert.notEqual(ErrorCode.PAYLOAD_TOO_LARGE, seen?.code);
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(trap.reasons, []);
    } finally {
      trap.restore();
      await running.close();
    }
  });
});
