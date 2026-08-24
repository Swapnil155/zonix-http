// ZH-009 / ZH-020 · CWE-22, CWE-158 · router path & param decoding safety.
//
// Covers: single-pass decoding, malformed-encoding rejection, encoded-slash
// staying inside a segment, null-byte rejection in decoded params (ZH-020),
// and prototype-safety of req.params.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

function paramApp() {
  const app = makeApp();
  app.get("/echo/:value", (req, res) => res.json({ value: req.params.value }));
  app.get("/files/*", (req, res) => res.json({ rest: req.params["*"] }));
  app.get("/proto/:x", (req, res) => {
    const polluted = ({} as Record<string, unknown>)["polluted"];
    res.json({ x: req.params.x, polluted: polluted ?? null });
  });
  return app;
}

describe("ZH-009/ZH-020 router security", () => {
  test("a param is percent-decoded exactly once", async () => {
    // %2520 -> literal "%20" (one decode), NOT a space (which would be a double decode).
    await request(paramApp().server).get("/echo/a%2520b").expect(200, { value: "a%20b" });
  });

  test("malformed percent-encoding is a 400, not a crash", async () => {
    await request(paramApp().server).get("/echo/%ZZ").expect(400);
    await request(paramApp().server).get("/echo/%E0%A4").expect(400);
  });

  test("ZH-020: a null byte (%00) in a param is rejected with 400", async () => {
    await request(paramApp().server).get("/echo/file%00.txt").expect(400);
  });

  test("ZH-020: a null byte inside a wildcard capture is rejected with 400", async () => {
    await request(paramApp().server).get("/files/a/secret%00.txt").expect(400);
  });

  test("an encoded slash (%2F) stays inside one segment, not a separator", async () => {
    // /echo/a%2Fb must match :value = "a/b", not fall through to a two-segment path.
    await request(paramApp().server).get("/echo/a%2Fb").expect(200, { value: "a/b" });
  });

  test("a __proto__ param value cannot pollute Object.prototype", async () => {
    await request(paramApp().server)
      .get("/proto/__proto__")
      .expect(200, { x: "__proto__", polluted: null });
    // And the global prototype is intact afterward.
    assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
  });

  test("registering a route named :__proto__ throws at setup", () => {
    const app = makeApp();
    assert.throws(() => app.get("/:__proto__", (_q, res) => res.end()));
    assert.throws(() => app.get("/:constructor", (_q, res) => res.end()));
    assert.throws(() => app.get("/:prototype", (_q, res) => res.end()));
  });

  test("an over-long decoded param is a 414", async () => {
    const long = "a".repeat(300);
    await request(paramApp().server).get(`/echo/${long}`).expect(414);
  });
});
