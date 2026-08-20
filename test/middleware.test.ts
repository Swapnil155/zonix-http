import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import type { Middleware } from "../lib/index.js";
import { makeApp } from "./helpers.js";

describe("middleware chain", () => {
  test("global middleware runs in registration order, before the handler", async () => {
    const order: string[] = [];
    const app = makeApp();

    app.use((_req, _res, next) => {
      order.push("first");
      next();
    });
    app.use((_req, _res, next) => {
      order.push("second");
      next();
    });
    app.get("/", (_req, res) => {
      order.push("handler");
      res.status(200).json({ ok: true });
    });

    await request(app.server).get("/").expect(200, { ok: true });
    assert.deepEqual(order, ["first", "second", "handler"]);
  });

  test("route middleware runs after global middleware and before the handler", async () => {
    const order: string[] = [];
    const app = makeApp();
    const tag =
      (name: string): Middleware =>
      (_req, _res, next) => {
        order.push(name);
        next();
      };

    app.use(tag("global"));
    app.get("/x", tag("route-a"), tag("route-b"), (_req, res) => {
      order.push("handler");
      res.status(204).end();
    });

    await request(app.server).get("/x").expect(204);
    assert.deepEqual(order, ["global", "route-a", "route-b", "handler"]);
  });

  test("next(err) skips the rest of the chain", async () => {
    const reached: string[] = [];
    const app = makeApp();

    app.use((_req, _res, next) => {
      next(new Error("stop here"));
    });
    app.use((_req, _res, next) => {
      reached.push("second");
      next();
    });
    app.get("/", (_req, res) => {
      reached.push("handler");
      res.status(200).json({ ok: true });
    });
    app.handleErr((err, _req, res) => {
      res.status(500).json({ error: err.message });
    });

    await request(app.server).get("/").expect(500, { error: "stop here" });
    assert.deepEqual(reached, []);
  });

  test("calling next() twice is inert", async () => {
    let handlerCalls = 0;
    const app = makeApp();

    app.use((_req, _res, next) => {
      next();
      next();
      next(new Error("should be ignored"));
    });
    app.get("/", (_req, res) => {
      handlerCalls += 1;
      res.status(200).json({ calls: handlerCalls });
    });

    await request(app.server).get("/").expect(200, { calls: 1 });
    assert.equal(handlerCalls, 1);
  });

  test("async middleware is awaited before the chain advances", async () => {
    const order: string[] = [];
    const app = makeApp();

    app.use(async (_req, _res, next) => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("slow");
      next();
    });
    app.get("/", (_req, res) => {
      order.push("handler");
      res.status(200).json({ order });
    });

    await request(app.server).get("/").expect(200);
    assert.deepEqual(order, ["slow", "handler"]);
  });

  test("global middleware still runs when no route matches", async () => {
    let ran = false;
    const app = makeApp();

    app.use((_req, _res, next) => {
      ran = true;
      next();
    });

    await request(app.server).get("/nope").expect(404);
    assert.equal(ran, true);
  });

  test("a global middleware may respond and end the request early", async () => {
    let handlerRan = false;
    const app = makeApp();

    app.use((_req, res) => {
      res.status(401).json({ error: "unauthorized" });
    });
    app.get("/", (_req, res) => {
      handlerRan = true;
      res.status(200).json({ ok: true });
    });

    await request(app.server).get("/").expect(401, { error: "unauthorized" });
    assert.equal(handlerRan, false);
  });

  test("middleware registered after the first request still runs", async () => {
    // The per-route pipeline is cached; registering later must invalidate it.
    const seen: string[] = [];
    const app = makeApp();
    app.get("/x", (_req, res) => res.json({ seen: [...seen] }));

    await request(app.server).get("/x").expect(200, { seen: [] });

    app.use((_req, _res, next) => {
      seen.push("late");
      next();
    });

    await request(app.server)
      .get("/x")
      .expect(200, { seen: ["late"] });
    await request(app.server)
      .get("/x")
      .expect(200, { seen: ["late", "late"] });
  });

  test("a fallback registered after the first 404 still replaces the default", async () => {
    const app = makeApp();
    app.get("/known", (_req, res) => res.json({ ok: true }));

    await request(app.server).get("/missing").expect(404, { error: "Cannot GET /missing" });

    app.fallback((_req, res) => res.status(404).json({ custom: true }));

    await request(app.server).get("/missing").expect(404, { custom: true });
  });

  test("a route registered after the first request is reachable", async () => {
    const app = makeApp();
    app.get("/first", (_req, res) => res.json({ ok: true }));

    await request(app.server).get("/first").expect(200);
    await request(app.server).get("/second").expect(404);

    app.get("/second", (_req, res) => res.json({ second: true }));

    await request(app.server).get("/second").expect(200, { second: true });
  });

  test("app.use() rejects non-functions", () => {
    const app = makeApp();
    assert.throws(() => app.use(undefined as unknown as Middleware), /expects functions/);
  });
});
