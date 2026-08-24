import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import request from "supertest";
import express from "express";
import { ErrorCode, serveStatic, etag, type ZonixError } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

const siteRoot = fileURLToPath(new URL("../fixtures/site", import.meta.url));

function staticApp(options?: Parameters<typeof serveStatic>[1]) {
  const app = makeApp();
  app.use(serveStatic(siteRoot, options));
  return app;
}

describe("serveStatic Cache-Control (maxAge / immutable)", () => {
  test("nothing is sent by default (documented deviation from Express's max-age=0)", async () => {
    const res = await request(staticApp().server).get("/style.css").expect(200);
    assert.equal(res.headers["cache-control"], undefined);
  });

  test("maxAge in milliseconds", async () => {
    const res = await request(staticApp({ maxAge: 60_000 }).server)
      .get("/style.css")
      .expect(200);
    assert.equal(res.headers["cache-control"], "public, max-age=60");
  });

  test("duration strings", async () => {
    for (const [given, seconds] of [
      ["30s", 30],
      ["5m", 300],
      ["12h", 43_200],
      ["7d", 604_800],
      ["1w", 604_800],
      ["1y", 31_536_000],
      ["250ms", 0],
    ] as const) {
      const res = await request(staticApp({ maxAge: given }).server)
        .get("/style.css")
        .expect(200);
      assert.equal(res.headers["cache-control"], `public, max-age=${seconds}`, given);
    }
  });

  test("maxAge is clamped to one year, matching send", async () => {
    const res = await request(staticApp({ maxAge: "5y" }).server)
      .get("/style.css")
      .expect(200);
    assert.equal(res.headers["cache-control"], "public, max-age=31536000");
  });

  test("immutable appends; immutable alone implies max-age=0", async () => {
    const both = await request(staticApp({ maxAge: "1d", immutable: true }).server)
      .get("/style.css")
      .expect(200);
    assert.equal(both.headers["cache-control"], "public, max-age=86400, immutable");

    const alone = await request(staticApp({ immutable: true }).server)
      .get("/style.css")
      .expect(200);
    assert.equal(alone.headers["cache-control"], "public, max-age=0, immutable");
  });

  test("the header rides on 304 responses too", async () => {
    const app = makeApp();
    app.use(etag());
    app.use(serveStatic(siteRoot, { maxAge: "1h" }));
    const first = await request(app.server).get("/style.css").expect(200);
    const tag = first.headers.etag as string;
    const revalidated = await request(app.server)
      .get("/style.css")
      .set("If-None-Match", tag)
      .expect(304);
    assert.equal(revalidated.headers["cache-control"], "public, max-age=3600");
  });

  test("the header rides on 206 range responses", async () => {
    const res = await request(staticApp({ maxAge: "1h" }).server)
      .get("/style.css")
      .set("Range", "bytes=0-3")
      .expect(206);
    assert.equal(res.headers["cache-control"], "public, max-age=3600");
  });

  test("the memory-cache path sends the same header, cold and warm", async () => {
    const app = staticApp({ maxAge: "1h", cache: { maxBytes: 1024 * 1024 } });
    const cold = await request(app.server).get("/style.css").expect(200);
    const warm = await request(app.server).get("/style.css").expect(200);
    assert.equal(cold.headers["cache-control"], "public, max-age=3600");
    assert.equal(warm.headers["cache-control"], "public, max-age=3600");
  });

  test("a Cache-Control already set upstream wins", async () => {
    const app = makeApp();
    app.use((_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    });
    app.use(serveStatic(siteRoot, { maxAge: "1h" }));
    const res = await request(app.server).get("/style.css").expect(200);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("an unreadable maxAge throws at setup, not per request", () => {
    for (const bad of ["fortnight", "1 fort", "", "-5s", NaN, -1, Infinity]) {
      assert.throws(
        () => serveStatic(siteRoot, { maxAge: bad as never }),
        (err: unknown) => (err as ZonixError).code === ErrorCode.INVALID_ARGUMENT,
        String(bad),
      );
    }
  });

  test("wire diff: header matches express.static byte for byte", async () => {
    const cases = [
      { maxAge: "1h" as const },
      { maxAge: 90_000 },
      { maxAge: "2d" as const, immutable: true },
    ];
    for (const opts of cases) {
      const zonixApp = staticApp(opts);
      const expressApp = express();
      expressApp.use(express.static(siteRoot, opts));

      const ours = await request(zonixApp.server).get("/style.css").expect(200);
      const theirs = await request(expressApp).get("/style.css").expect(200);
      assert.equal(
        ours.headers["cache-control"],
        theirs.headers["cache-control"],
        JSON.stringify(opts),
      );
    }
  });
});
