// ZH-008 · host header — X-Forwarded-Host is trusted only when trustProxy is on,
// and no absolute-URL/redirect derives from the Host header.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import zonix from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

describe("ZH-008 host header", () => {
  test("with trust off, X-Forwarded-Host is ignored; the Host header is used", async () => {
    const app = makeApp();
    app.get("/", (req, res) => res.json({ host: req.host, hostname: req.hostname }));
    const res = await request(app.server)
      .get("/")
      .set("Host", "real.example")
      .set("X-Forwarded-Host", "attacker.example")
      .expect(200);
    assert.equal(res.body.hostname, "real.example");
    assert.doesNotMatch(String(res.body.host), /attacker/);
  });

  test("with trustProxy on, X-Forwarded-Host is honoured", async () => {
    const app = zonix({ trustProxy: true });
    app.get("/", (req, res) => res.json({ hostname: req.hostname }));
    const res = await request(app.server)
      .get("/")
      .set("X-Forwarded-Host", "forwarded.example")
      .expect(200);
    assert.equal(res.body.hostname, "forwarded.example");
  });

  test("res.redirect does not derive its target from the Host header", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.redirect("/next"));
    // A spoofed (but syntactically valid) Host must not leak into the redirect.
    const res = await request(app.server).get("/").set("Host", "evil.example").redirects(0);
    assert.equal(res.headers.location, "/next");
    assert.doesNotMatch(String(res.headers.location ?? ""), /evil/);
  });
});
