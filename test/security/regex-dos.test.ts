// ZH-010 · CWE-1333 · regex / algorithmic complexity DoS.
//
// zonix uses linear-time character scanners on every attacker-controlled parsing
// path (no catastrophic-backtracking regex). These tests feed worst-case
// adversarial strings and assert bounded execution time.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import zonix, { parseExtendedQuery } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

/** Run `fn` and assert it finished within `budgetMs`. */
function withinTime(budgetMs: number, fn: () => void): void {
  const start = process.hrtime.bigint();
  fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < budgetMs, `took ${ms.toFixed(1)}ms, budget ${budgetMs}ms`);
}

describe("ZH-010 regex/complexity DoS", () => {
  test("adversarial Accept-Encoding parses in bounded time", async () => {
    const app = makeApp();
    app.get("/", (req, res) => res.json({ enc: req.acceptsEncodings() }));
    const evil = "gzip;q=0.1," + "a".repeat(6000) + ";q=1,deflate"; // under maxHeaderSize
    const start = Date.now();
    await request(app.server).get("/").set("Accept-Encoding", evil).expect(200);
    assert.ok(Date.now() - start < 1000, "Accept-Encoding parse was slow");
  });

  test("adversarial query string parses in bounded time", () => {
    const evil = "a" + "[b]".repeat(10000) + "=1"; // deep bracket nesting
    withinTime(500, () => {
      parseExtendedQuery(evil);
    });
  });

  test("long repeated cookie header parses in bounded time", async () => {
    const app = makeApp();
    const { cookieParser } = await import("../../lib/index.js");
    app.use(cookieParser());
    app.get("/", (_req, res) => res.json({ ok: true }));
    const evil = Array.from({ length: 900 }, (_v, i) => `k${i}=v${i}`).join("; "); // under maxHeaderSize
    const start = Date.now();
    await request(app.server).get("/").set("Cookie", evil).expect(200);
    assert.ok(Date.now() - start < 1000, "cookie parse was slow");
  });

  test("adversarial Range header parses in bounded time", async () => {
    const app = zonix();
    app.get("/", (req, res) => res.json({ r: req.range?.(1000) ?? null }));
    const evil = "bytes=" + Array.from({ length: 1500 }, (_v, i) => `${i}-${i + 1}`).join(","); // under maxHeaderSize
    const start = Date.now();
    await request(app.server).get("/").set("Range", evil).expect(200);
    assert.ok(Date.now() - start < 1000, "range parse was slow");
  });
});
