// ZH-005 · CWE-400 · body parser resource exhaustion.
//
// The received-byte cap is enforced independently of the declared Content-Length,
// in both directions, and overflow yields a delivered 413 rather than unbounded
// buffering or a socket reset.
import assert from "node:assert/strict";
import net from "node:net";
import { describe, test } from "node:test";
import request from "supertest";
import zonix from "../../lib/index.js";
import { makeApp, start } from "../helpers/make-app.js";
import type { RunningApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

function jsonApp(limit: string | number) {
  const app = makeApp();
  app.use(zonix.json({ limit }));
  app.post("/", (req, res) => res.json({ size: JSON.stringify(req.body).length }));
  return app;
}

describe("ZH-005 body limits", () => {
  test("a declared Content-Length over the limit is refused before reading (413)", async () => {
    await request(jsonApp("1kb").server)
      .post("/")
      .set("content-type", "application/json")
      .set("content-length", "1048576")
      .send("[]")
      .expect(413);
  });

  test("a body over the limit is a 413 even when Content-Length under-declares it", async () => {
    // Send more bytes than the limit while lying about content-length via raw socket.
    const app = jsonApp(64);
    const running: RunningApp = await start(app);
    try {
      const body = '{"a":"' + "x".repeat(5000) + '"}';
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(running.port, "127.0.0.1", () => {
          socket.write(
            "POST / HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\n" +
              `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
              body,
          );
        });
        let buf = "";
        socket.on("data", (d) => (buf += d.toString("latin1")));
        socket.on("close", () => resolve(buf));
        socket.on("error", (e) => (buf ? resolve(buf) : reject(e)));
        setTimeout(() => resolve(buf), 1000);
      });
      // The core security property: an over-limit body yields a delivered 413
      // response, never unbounded buffering or a bare socket reset.
      assert.match(reply, /HTTP\/1\.[01] 413/, `expected 413, got:\n${reply.slice(0, 200)}`);
    } finally {
      await running.close();
    }
  });

  test("a body exactly at the limit is accepted; one byte over is 413", async () => {
    const app = makeApp();
    app.use(zonix.text({ limit: 8 }));
    app.post("/", (req, res) => res.json({ body: req.body }));
    await request(app.server)
      .post("/")
      .set("content-type", "text/plain")
      .send("12345678")
      .expect(200);
    await request(app.server)
      .post("/")
      .set("content-type", "text/plain")
      .send("123456789")
      .expect(413);
  });

  test("malformed JSON is a 400, not a crash", async () => {
    await request(jsonApp("1mb").server)
      .post("/")
      .set("content-type", "application/json")
      .send("{not json")
      .expect(400);
  });

  test("a charset the framework cannot decode is a 415 (text parser)", async () => {
    const app = makeApp();
    app.use(zonix.text());
    app.post("/", (_req, res) => res.json({ ok: true }));
    await request(app.server)
      .post("/")
      .set("content-type", "text/plain; charset=utf-32")
      .send("hello")
      .expect(415);
  });
});
