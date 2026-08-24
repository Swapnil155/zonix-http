// ZH-014 · CWE-601 · open redirect.
//
// res.redirect is Express-compatible: it redirects wherever the app tells it to.
// The framework's job is that CRLF cannot split the response and that the target
// is not silently rewritten. Open-redirect avoidance (validating a user-supplied
// destination) is the application's responsibility and is documented as such.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

function redirectApp(target: string) {
  const app = makeApp();
  app.get("/", (_req, res) => res.redirect(target));
  return app;
}

describe("ZH-014 redirect security", () => {
  test("CRLF in a redirect target is percent-encoded, not split", async () => {
    const res = await request(redirectApp("/next\r\nX-Evil: injected").server)
      .get("/")
      .redirects(0);
    assert.equal(res.headers["x-evil"], undefined, "redirect target injected a header");
    assert.match(res.headers.location as string, /%0[dD]|%0[aA]/);
  });

  test("a protocol-relative target is passed through unchanged (app responsibility, documented)", async () => {
    // We do NOT silently rewrite //evil.example — that would break legitimate
    // protocol-relative redirects. Apps must validate user-supplied destinations.
    const res = await request(redirectApp("//evil.example/path").server).get("/").redirects(0);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "//evil.example/path");
  });

  test("a javascript: target is not executed by the framework (browser concern) but is not split", async () => {
    const res = await request(redirectApp("javascript:alert(1)").server).get("/").redirects(0);
    assert.doesNotMatch(res.headers.location as string, /\r|\n/);
  });
});
