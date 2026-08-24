// ZH-019 · CWE-400 · resource exhaustion across every input dimension.
//
// A single suite that asserts every bounded dimension has an enforced limit:
// body bytes, query nesting depth, query parameter count, route-param length,
// and (via Node) header size. Cross-references ZH-004/005/006/010/015.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import zonix, { parseExtendedQuery, type ZonixError } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

describe("ZH-019 resource exhaustion — enforced limits", () => {
  test("body bytes are bounded (413)", async () => {
    const app = makeApp();
    app.use(zonix.json({ limit: 32 }));
    app.post("/", (_req, res) => res.json({ ok: true }));
    await request(app.server)
      .post("/")
      .set("content-type", "application/json")
      .send(JSON.stringify({ a: "x".repeat(100) }))
      .expect(413);
  });

  test("query nesting depth is bounded (extended parser caps, no unbounded recursion)", () => {
    const deep = "a" + "[b]".repeat(1000) + "=1";
    const out = parseExtendedQuery(deep) as Record<string, unknown>;
    // Past depth 5 the remainder is folded into a leaf key rather than nesting further.
    let node: unknown = out.a;
    let levels = 0;
    while (node && typeof node === "object" && levels < 100) {
      node = (node as Record<string, unknown>).b;
      levels++;
    }
    assert.ok(levels <= 7, `nesting not bounded: descended ${levels} levels`);
  });

  test("query parameter count is bounded (413 when throwing)", () => {
    const many = Array.from({ length: 2000 }, (_v, i) => `k${i}=${i}`).join("&");
    assert.throws(
      () => parseExtendedQuery(many, { parameterLimit: 1000, throwOnParameterLimit: true }),
      (err: unknown) => (err as ZonixError).status === 413,
    );
  });

  test("route-param length is bounded (414)", async () => {
    const app = makeApp();
    app.get("/:x", (_req, res) => res.json({ ok: true }));
    await request(app.server)
      .get(`/${"a".repeat(500)}`)
      .expect(414);
  });

  test("slow-client timeouts are configured (ZH-004 cross-check)", () => {
    const app = makeApp();
    assert.ok(app.server.headersTimeout > 0);
    assert.ok(app.server.requestTimeout > 0);
    assert.ok(app.server.keepAliveTimeout > 0);
  });
});
