/**
 * `urlencoded()` (simple + extended), `raw()` and `text()`: content-type
 * gates, charset handling, byte-exact limits, empty bodies, and the rule-3
 * equivalence that one write, dribbled bytes and chunked transfer encoding
 * put identical bytes on the wire - plus the chunked overflow that must be a
 * delivered 413 + Connection: close, never a socket reset.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { describe, test } from "node:test";
import request from "supertest";
import {
  ErrorCode,
  raw,
  text,
  urlencoded,
  type Middleware,
  type ZonixError,
} from "../../lib/index.js";
import { makeApp, start } from "../helpers/make-app.js";
import { trapUnhandledRejections } from "../helpers/tripwire.js";

const trap = trapUnhandledRejections();
process.on("exit", () => {
  trap.restore();
  assert.deepEqual(trap.reasons, []);
});

function app(mw: Middleware) {
  const a = makeApp();
  a.post("/echo", mw, (req, res) => {
    const body = req.body;
    res.json({
      type: Buffer.isBuffer(body) ? "buffer" : typeof body,
      proto:
        body !== null && typeof body === "object" && !Buffer.isBuffer(body)
          ? Object.getPrototypeOf(body) === null
          : undefined,
      body: Buffer.isBuffer(body) ? body.toString("base64") : body === undefined ? null : body,
    });
  });
  a.handleErr((err, _req, res) => {
    if (res.headersSent) return;
    res.status(err.status ?? 500).json({ code: err.code });
  });
  return a;
}

describe("urlencoded(): simple", () => {
  test("parses a form; repeated keys become arrays (querystring semantics); null prototype", async () => {
    const a = app(urlencoded());
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a=1&b=two+words&c=%E2%9C%93&a=2&empty=&flag")
      .expect(200);
    assert.deepEqual(r.body.body, { a: ["1", "2"], b: "two words", c: "✓", empty: "", flag: "" });
    assert.equal(r.body.proto, true);
  });

  test("brackets stay literal keys in simple mode", async () => {
    const a = app(urlencoded());
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a[b]=1&a[c]=2")
      .expect(200);
    assert.deepEqual(r.body.body, { "a[b]": "1", "a[c]": "2" });
  });

  test("an empty body is {} with a null prototype; other types and GETs pass through", async () => {
    const a = app(urlencoded());
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("")
      .expect(200);
    assert.deepEqual(r.body, { type: "object", proto: true, body: {} });
    const json = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"a":1}')
      .expect(200);
    assert.deepEqual(json.body, { type: "undefined", body: null });
  });

  test("a non-UTF-8 charset is a 415 before the body is read", async () => {
    const a = app(urlencoded());
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded; charset=iso-8859-1")
      .send("a=1")
      .expect(415);
    assert.equal(r.body.code, ErrorCode.UNSUPPORTED_CHARSET);
    await request(a.server)
      .post("/echo")
      .set("Content-Type", 'application/x-www-form-urlencoded; charset="UTF-8"')
      .send("a=1")
      .expect(200);
  });

  test("parameterLimit: at the limit passes, one over is a 413", async () => {
    const a = app(urlencoded({ parameterLimit: 3 }));
    await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a=1&b=2&c=3")
      .expect(200);
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a=1&b=2&c=3&d=4")
      .expect(413);
    assert.equal(r.body.code, ErrorCode.TOO_MANY_PARAMETERS);
  });

  test("a custom type list and a leading BOM", async () => {
    const a = app(
      urlencoded({ type: ["application/x-www-form-urlencoded", "application/vnd.form"] }),
    );
    await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/vnd.form")
      .send("﻿a=1")
      .expect(200, { type: "object", proto: true, body: { a: "1" } });
  });

  test("option validation happens at setup", () => {
    assert.throws(() => urlencoded({ parameterLimit: 0 }), { code: ErrorCode.INVALID_ARGUMENT });
    assert.throws(() => urlencoded({ depth: -1 }), { code: ErrorCode.INVALID_ARGUMENT });
    assert.throws(() => urlencoded({ limit: "lots" }), { code: ErrorCode.INVALID_ARGUMENT });
  });
});

describe("urlencoded(): extended", () => {
  test("nests brackets; prototype keys dropped; arrays up to max(100, params)", async () => {
    const a = app(urlencoded({ extended: true }));
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("user[name]=Ada&user[tags][]=x&user[tags][]=y&__proto__[polluted]=1&a[50]=z")
      .expect(200);
    assert.deepEqual(r.body.body, {
      user: { name: "Ada", tags: ["x", "y"] },
      a: ["z"],
    });
    assert.equal(({} as { polluted?: unknown }).polluted, undefined);
  });

  test("depth: 32 levels pass, 33 is a 400", async () => {
    const a = app(urlencoded({ extended: true }));
    const ok = "a" + "[b]".repeat(32) + "=1";
    await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(ok)
      .expect(200);
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a" + "[b]".repeat(33) + "=1")
      .expect(400);
    assert.equal(r.body.code, ErrorCode.QUERY_TOO_DEEP);
    const shallow = app(urlencoded({ extended: true, depth: 1 }));
    await request(shallow.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a[b][c]=1")
      .expect(400);
  });

  test("parameterLimit in extended mode is a 413 too", async () => {
    const a = app(urlencoded({ extended: true, parameterLimit: 2 }));
    await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a=1&b=2&c=3")
      .expect(413);
  });
});

describe("raw() and text()", () => {
  test("raw buffers octet-stream bodies byte-for-byte; other types pass through", async () => {
    const a = app(raw());
    const bytes = Buffer.from([0, 1, 2, 255, 254, 0x0a, 0x0d]);
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/octet-stream")
      .send(bytes)
      .expect(200);
    assert.equal(r.body.type, "buffer");
    assert.equal(Buffer.from(r.body.body, "base64").equals(bytes), true);
    const skip = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .send("x")
      .expect(200);
    assert.equal(skip.body.type, "undefined");
    const empty = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/octet-stream")
      .send("")
      .expect(200);
    assert.deepEqual(empty.body, { type: "buffer", body: "" });
  });

  test('raw({ type: "*/*" }) takes everything, including JSON', async () => {
    const a = app(raw({ type: "*/*" }));
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"a":1}')
      .expect(200);
    assert.equal(Buffer.from(r.body.body, "base64").toString(), '{"a":1}');
  });

  test("text decodes by charset: utf-8 default, latin1, utf-16le; unknown is a 415", async () => {
    const a = app(text());
    const utf8 = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .send("héllo ✓")
      .expect(200);
    assert.deepEqual(utf8.body, { type: "string", body: "héllo ✓" });

    const latin = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain; charset=iso-8859-1")
      .send(Buffer.from("h\xe9llo", "latin1"))
      .expect(200);
    assert.equal(latin.body.body, "héllo");

    const utf16 = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain; charset=utf-16le")
      .send(Buffer.from("wide ✓", "utf16le"))
      .expect(200);
    assert.equal(utf16.body.body, "wide ✓");

    const bad = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain; charset=koi8-r")
      .send("x")
      .expect(415);
    assert.equal(bad.body.code, ErrorCode.UNSUPPORTED_CHARSET);

    const empty = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .send("")
      .expect(200);
    assert.deepEqual(empty.body, { type: "string", body: "" });
  });

  test("text honours defaultCharset and a type list; text/html passes through by default", async () => {
    const a = app(text({ defaultCharset: "latin1" }));
    const r = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .send(Buffer.from("caf\xe9", "latin1"))
      .expect(200);
    assert.equal(r.body.body, "café");
    const skip = await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/html")
      .send("<p>")
      .expect(200);
    assert.equal(skip.body.type, "undefined");
    const html = app(text({ type: "text/*" }));
    const got = await request(html.server)
      .post("/echo")
      .set("Content-Type", "text/html")
      .send("<p>")
      .expect(200);
    assert.equal(got.body.body, "<p>");
  });

  test("a body already set by an earlier parser is left alone", async () => {
    const a = makeApp();
    a.post("/echo", text(), raw({ type: "*/*" }), (req, res) => res.json({ t: typeof req.body }));
    await request(a.server)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .send("x")
      .expect(200, { t: "string" });
  });
});

// --- limits and equivalence over a raw socket --------------------------------

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
const head = (type: string, length?: number) =>
  `POST /echo HTTP/1.1\r\nHost: t\r\nContent-Type: ${type}\r\n` +
  (length === undefined ? "Transfer-Encoding: chunked\r\n" : `Content-Length: ${length}\r\n`) +
  "Connection: close\r\n\r\n";
const chunk = (b: Buffer | string) => {
  const buf = Buffer.from(b);
  return Buffer.concat([Buffer.from(`${buf.length.toString(16)}\r\n`), buf, Buffer.from("\r\n")]);
};
const LAST = "0\r\n\r\n";

const PARSERS: Array<[string, string, Middleware, Buffer]> = [
  [
    "urlencoded",
    "application/x-www-form-urlencoded",
    urlencoded({ limit: 64 }),
    Buffer.from("name=Ada+Lovelace&tag=%E2%9C%93&x=1&x=2"),
  ],
  [
    "urlencoded-extended",
    "application/x-www-form-urlencoded",
    urlencoded({ limit: 64, extended: true }),
    Buffer.from("u[name]=Ada&u[tags][]=%E2%9C%93&u[tags][]=b"),
  ],
  [
    "raw",
    "application/octet-stream",
    raw({ limit: 64 }),
    Buffer.from([1, 2, 3, 0, 255, 0xe2, 0x9c, 0x93, 9, 10]),
  ],
  ["text", "text/plain; charset=utf-8", text({ limit: 64 }), Buffer.from("snow ☃ man ✓ end")],
];

describe("parsers: one write, dribbled bytes and chunked encoding are wire-identical", () => {
  for (const [name, type, mw, body] of PARSERS) {
    test(name, async () => {
      const running = await start(app(mw));
      try {
        const port = running.port;
        const one = await rawPost(port, head(type, body.length), [body]);
        // Cut inside the multi-byte sequence so no piece is valid on its own.
        // Cut inside the multi-byte sequence when there is one (raw/text), else mid-body.
        const at = body.indexOf(0xe2);
        const cut = (at === -1 ? 5 : at) + 1;
        const dribbled = await rawPost(port, head(type, body.length), [
          body.subarray(0, 2),
          body.subarray(2, cut),
          body.subarray(cut, cut + 1),
          body.subarray(cut + 1),
        ]);
        const chunked = await rawPost(port, head(type), [
          chunk(body.subarray(0, cut)),
          chunk(body.subarray(cut)),
          LAST,
        ]);
        assert.ok(one.startsWith("HTTP/1.1 200"), one);
        assert.equal(stripDate(dribbled), stripDate(one));
        assert.equal(stripDate(chunked), stripDate(one));
      } finally {
        await running.close();
      }
    });
  }
});

describe("parsers: byte-exact limits", () => {
  for (const [name, type, mw] of PARSERS) {
    test(`${name}: 64 bytes pass, 65 is a 413; chunked overflow is a delivered 413 + close`, async () => {
      const running = await start(app(mw));
      try {
        const port = running.port;
        const fill = (n: number) => Buffer.from("a=" + "x".repeat(n - 2));
        const ok = await rawPost(port, head(type, 64), [fill(64)]);
        assert.ok(ok.startsWith("HTTP/1.1 200"), ok);
        const over = await rawPost(port, head(type, 65), [fill(65)]);
        assert.ok(over.startsWith("HTTP/1.1 413"), over);
        assert.match(over, /Connection: close/i);
        assert.match(over, /PAYLOAD_TOO_LARGE/);
        // No Content-Length to pre-check: the limit must bite mid-stream.
        const chunked = await rawPost(port, head(type), [chunk(fill(40)), chunk(fill(40)), LAST]);
        assert.ok(chunked.startsWith("HTTP/1.1 413"), chunked);
        assert.match(chunked, /Connection: close/i);
        const chunkedOk = await rawPost(port, head(type), [chunk(fill(32)), chunk(fill(32)), LAST]);
        assert.ok(chunkedOk.startsWith("HTTP/1.1 200"), chunkedOk);
      } finally {
        await running.close();
      }
    });
  }

  test("a client that disconnects mid-body is tagged, not crashed", async () => {
    const a = makeApp();
    const seen: ZonixError[] = [];
    a.post("/echo", text(), (_req, res) => res.end("ok"));
    a.handleErr((err) => {
      seen.push(err);
    });
    const running = await start(a);
    try {
      await new Promise<void>((resolve) => {
        const socket = net.connect(running.port, "127.0.0.1", () => {
          socket.write(head("text/plain", 100) + "partial");
          setTimeout(() => socket.destroy(), 20);
        });
        socket.on("close", () => setTimeout(resolve, 30));
      });
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.clientDisconnect, true);
    } finally {
      await running.close();
    }
  });
});
