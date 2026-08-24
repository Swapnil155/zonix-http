// ZH-013 · proxy trust — X-Forwarded-* is ignored unless trustProxy says otherwise.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import zonix from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

function ipApp(trustProxy?: Parameters<typeof zonix>[0] extends infer O ? unknown : never) {
  const app = trustProxy === undefined ? makeApp() : zonix({ trustProxy: trustProxy as never });
  app.get("/", (req, res) =>
    res.json({ ip: req.ip, ips: req.ips, protocol: req.protocol, secure: req.secure }),
  );
  return app;
}

describe("ZH-013 proxy trust", () => {
  test("with trust off (default), a spoofed X-Forwarded-For is ignored", async () => {
    const res = await request(ipApp().server)
      .get("/")
      .set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
      .expect(200);
    assert.notEqual(res.body.ip, "1.2.3.4", "spoofed XFF became req.ip with trust off");
    assert.deepEqual(res.body.ips, [], "req.ips should be empty with trust off");
  });

  test("with trust off, a spoofed X-Forwarded-Proto does not make the request 'secure'", async () => {
    const res = await request(ipApp().server)
      .get("/")
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    assert.equal(res.body.protocol, "http");
    assert.equal(res.body.secure, false);
  });

  test("with trustProxy true, X-Forwarded-For is honoured (client-typed leftmost)", async () => {
    const res = await request(ipApp(true).server)
      .get("/")
      .set("X-Forwarded-For", "1.2.3.4")
      .expect(200);
    assert.equal(res.body.ip, "1.2.3.4");
  });

  test("with a hop count, an attacker prepending extra XFF entries cannot jump the boundary", async () => {
    // trust exactly 1 hop: the nearest (rightmost) entry is trusted, the injected
    // leftmost client entries are not returned as the resolved ip.
    const res = await request(ipApp(1).server)
      .get("/")
      .set("X-Forwarded-For", "9.9.9.9, 8.8.8.8")
      .expect(200);
    // The resolved ip must not be the attacker-injected leftmost entry.
    assert.notEqual(res.body.ip, "9.9.9.9");
  });
});
