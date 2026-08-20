import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { ErrorCode, parseJSON, type ZonixError } from "../lib/index.js";
import { makeApp } from "./helpers.js";

/** App that echoes whatever ended up on req.body, plus its type. */
function echoApp(limit?: string | number) {
  const app = makeApp();
  app.use(limit === undefined ? parseJSON() : parseJSON({ limit }));
  app.post("/echo", (req, res) => res.json({ body: req.body ?? null, type: typeof req.body }));
  app.get("/echo", (req, res) => res.json({ body: req.body ?? null, type: typeof req.body }));
  return app;
}

describe("parseJSON", () => {
  test("parses a valid body into req.body", async () => {
    const app = echoApp();
    await request(app.server)
      .post("/echo")
      .send({ name: "swapnil", tags: [1, 2, 3] })
      .expect(200, { body: { name: "swapnil", tags: [1, 2, 3] }, type: "object" });
  });

  test("an empty body parses to {}", async () => {
    const app = echoApp();
    await request(app.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send("")
      .expect(200, { body: {}, type: "object" });
  });

  test("malformed JSON is a 400", async () => {
    const app = echoApp();
    let seen: ZonixError | undefined;
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(err.status ?? 500).json({ error: "bad json" });
    });

    await request(app.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"broken": ')
      .expect(400, { error: "bad json" });
    assert.equal(seen?.code, ErrorCode.INVALID_JSON);
  });

  test("a non-JSON content type passes through untouched", async () => {
    const app = echoApp();
    await request(app.server)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .send('{"ignored":true}')
      .expect(200, { body: null, type: "undefined" });
  });

  test("a GET with no body is unaffected", async () => {
    const app = echoApp();
    await request(app.server).get("/echo").expect(200, { body: null, type: "undefined" });
  });

  test("charset and vendor +json content types are parsed", async () => {
    const app = echoApp();
    await request(app.server)
      .post("/echo")
      .set("Content-Type", "application/vnd.api+json; charset=utf-8")
      .send('{"vendor":true}')
      .expect(200, { body: { vendor: true }, type: "object" });
  });

  test("a body at exactly the limit is accepted", async () => {
    // {"a":"xxx..."} - pad so the encoded body is exactly 64 bytes.
    const overhead = Buffer.byteLength('{"a":""}');
    const payload = JSON.stringify({ a: "x".repeat(64 - overhead) });
    assert.equal(Buffer.byteLength(payload), 64);

    const app = echoApp(64);
    await request(app.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(payload)
      .expect(200);
  });

  test("one byte over the limit is a 413", async () => {
    const overhead = Buffer.byteLength('{"a":""}');
    const payload = JSON.stringify({ a: "x".repeat(65 - overhead) });
    assert.equal(Buffer.byteLength(payload), 65);

    const app = echoApp(64);
    let seen: ZonixError | undefined;
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(err.status ?? 500).json({ error: "too large" });
    });

    await request(app.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(payload)
      .expect(413, { error: "too large" });
    assert.equal(seen?.code, ErrorCode.PAYLOAD_TOO_LARGE);
  });

  test("the limit counts bytes, not characters", async () => {
    // 20 multi-byte characters: 20 chars, 60 bytes, plus 8 bytes of JSON overhead.
    const payload = JSON.stringify({ a: "☃".repeat(20) });
    assert.equal(payload.length, 28);
    assert.equal(Buffer.byteLength(payload), 68);

    const app = echoApp(40);
    app.handleErr((err, _req, res) => res.status(err.status ?? 500).json({ error: "too large" }));

    await request(app.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(payload)
      .expect(413);
  });

  test("an oversized Content-Length is rejected before the body is read", async () => {
    const app = echoApp("1kb");
    app.handleErr((err, _req, res) => res.status(err.status ?? 500).json({ error: err.code }));

    await request(app.server)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ a: "x".repeat(4096) }))
      .expect(413, { error: ErrorCode.PAYLOAD_TOO_LARGE });
  });

  test('limit strings such as "1mb" are understood', async () => {
    const app = echoApp("1mb");
    await request(app.server)
      .post("/echo")
      .send({ padded: "y".repeat(2000) })
      .expect(200);
  });

  test("an unreadable limit throws at setup, not at request time", () => {
    assert.throws(() => parseJSON({ limit: "loads" }), /cannot read limit/i);
  });

  test("a JSON array body is preserved", async () => {
    const app = echoApp();
    await request(app.server)
      .post("/echo")
      .send([1, 2, 3])
      .expect(200, { body: [1, 2, 3], type: "object" });
  });

  test("a body already set by earlier middleware is left alone", async () => {
    const app = makeApp();
    app.use((req, _res, next) => {
      req.body = { preset: true };
      next();
    });
    app.use(parseJSON());
    app.post("/echo", (req, res) => res.json(req.body));

    await request(app.server).post("/echo").send({ ignored: true }).expect(200, { preset: true });
  });
});
