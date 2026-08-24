// ZH-022 · opt-in securityHeaders() middleware.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { securityHeaders } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

function app(opts?: Parameters<typeof securityHeaders>[0]) {
  const a = makeApp();
  a.use(securityHeaders(opts));
  a.get("/", (_req, res) => res.json({ ok: true }));
  return a;
}

describe("ZH-022 securityHeaders()", () => {
  test("safe defaults are on for every response", async () => {
    const res = await request(app().server).get("/").expect(200);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
    assert.equal(res.headers["x-frame-options"], "DENY");
  });

  test("breakable headers (CSP, HSTS, Permissions-Policy) are OFF unless configured", async () => {
    const res = await request(app().server).get("/").expect(200);
    assert.equal(res.headers["content-security-policy"], undefined);
    assert.equal(res.headers["strict-transport-security"], undefined);
    assert.equal(res.headers["permissions-policy"], undefined);
  });

  test("CSP and Permissions-Policy are sent when configured", async () => {
    const res = await request(
      app({ contentSecurityPolicy: "default-src 'self'", permissionsPolicy: "geolocation=()" })
        .server,
    )
      .get("/")
      .expect(200);
    assert.equal(res.headers["content-security-policy"], "default-src 'self'");
    assert.equal(res.headers["permissions-policy"], "geolocation=()");
  });

  test("a default header can be disabled with false", async () => {
    const res = await request(app({ frameOptions: false }).server).get("/").expect(200);
    assert.equal(res.headers["x-frame-options"], undefined);
    assert.equal(res.headers["x-content-type-options"], "nosniff"); // others still on
  });

  test("HSTS is suppressed on plaintext (non-HTTPS) responses", async () => {
    // The test server is plaintext, so even with HSTS configured it must not be sent.
    const res = await request(app({ strictTransportSecurity: "max-age=31536000" }).server)
      .get("/")
      .expect(200);
    assert.equal(res.headers["strict-transport-security"], undefined);
  });

  test("a header a handler already set is not overridden", async () => {
    const a = makeApp();
    a.use(securityHeaders());
    a.get("/", (_req, res) => {
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.json({ ok: true });
    });
    const res = await request(a.server).get("/").expect(200);
    assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
  });
});
