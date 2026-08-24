// ZH-018 · HTTP method handling — TRACE not reflected, no method override, HEAD mirrors GET.
import assert from "node:assert/strict";
import net from "node:net";
import { describe, test } from "node:test";
import request from "supertest";
import { makeApp, start } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

describe("ZH-018 method handling", () => {
  test("TRACE is not routable and does not echo the request", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.json({ ok: true }));
    const running = await start(app);
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(running.port, "127.0.0.1", () => {
          socket.write("TRACE / HTTP/1.1\r\nHost: t\r\nX-Secret: leakme\r\n\r\n");
        });
        let buf = "";
        socket.on("data", (d) => (buf += d.toString("latin1")));
        socket.on("close", () => resolve(buf));
        socket.on("error", (e) => (buf ? resolve(buf) : reject(e)));
        setTimeout(() => resolve(buf), 800);
      });
      // The request headers must not be reflected back in the body (no TRACE echo).
      assert.doesNotMatch(reply, /X-Secret: leakme/, "TRACE echoed the request headers");
    } finally {
      await running.close();
    }
  });

  test("HEAD mirrors GET headers without a body", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.json({ hello: "world" }));
    const get = await request(app.server).get("/").expect(200);
    const head = await request(app.server).head("/").expect(200);
    assert.equal(head.headers["content-type"], get.headers["content-type"]);
    assert.equal(head.text, undefined);
  });

  test("an X-HTTP-Method-Override header does NOT change routing", async () => {
    const app = makeApp();
    let deleted = false;
    app.delete("/thing", (_req, res) => {
      deleted = true;
      res.json({ deleted: true });
    });
    app.get("/thing", (_req, res) => res.json({ method: "GET" }));
    // A GET with an override header must remain a GET (no hidden method override).
    await request(app.server)
      .get("/thing")
      .set("X-HTTP-Method-Override", "DELETE")
      .expect(200, { method: "GET" });
    assert.equal(deleted, false, "method override bypassed routing");
  });
});
