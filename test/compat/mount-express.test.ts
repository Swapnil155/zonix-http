/**
 * Phase 8 wire-diff: the same two-router example app — nested routers, a
 * prefixed plain middleware, route params under a mount, router-level error
 * middleware, a custom 404 — built on real Express 4.22.2 and on zonix by
 * changing only the framework handle, then compared on the wire for a corpus
 * of requests (status, Content-Type, body; `req.url`/`path`/`baseUrl`/
 * `originalUrl`/`params`/`query` echoed through the body).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";
import zonix, { Router, type Zonix } from "../../lib/index.js";
import { start, type RunningApp } from "../helpers/make-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const express = createRequire(import.meta.url)("express") as any;

/** Build the example app on any `{ app, Router }` pair. */
function build(app: any, RouterCtor: () => any): void {
  const echo = (label: string) => (req: any, res: any) =>
    res.json({
      label,
      url: req.url,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      params: req.params,
      query: req.query,
      method: req.method,
    });

  const users = RouterCtor();
  users.get("/", echo("users.index"));
  users.get("/:id", echo("users.show"));
  users.post("/", echo("users.create"));
  users.get("/:id/boom", (req: any) => {
    throw new Error(`user ${req.params.id} exploded`);
  });
  users.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ where: "users", error: err.message });
  });

  const admin = RouterCtor();
  admin.get("/stats", echo("admin.stats"));
  admin.get("/fail", (_req: any, _res: any, next: any) => next(new Error("admin failed")));

  const api = RouterCtor();
  api.use((req: any, res: any, next: any) => {
    res.setHeader("x-api", req.baseUrl);
    next();
  });
  api.use("/users", users);
  api.use("/admin", admin);
  api.get("/", echo("api.root"));
  api.get("/echo", echo("api.echo"));
  api.use((err: any, req: any, res: any, _next: any) => {
    res.status(502).json({ where: "api", base: req.baseUrl, error: err.message });
  });

  app.use("/api", (req: any, res: any, next: any) => {
    res.setHeader("x-mounted-url", req.url);
    next();
  });
  app.use("/api", api);
  app.get("/", echo("root"));
  app.get("/top/:id", echo("top"));
  app.get("/head-only", (_req: any, res: any) => res.send("head me"));
}

function buildZonix(): Zonix {
  const app = zonix({ dev: false });
  build(app, Router);
  app.fallback((req, res) =>
    res.status(404).json({ notFound: req.originalUrl, base: req.baseUrl }),
  );
  return app;
}

function buildExpress(): any {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  build(app, express.Router);
  app.use((req: any, res: any) =>
    res.status(404).json({ notFound: req.originalUrl, base: req.baseUrl }),
  );
  return app;
}

const CORPUS: Array<[string, string]> = [
  ["GET", "/"],
  ["GET", "/api"],
  ["GET", "/api/"],
  ["GET", "/api/echo?x=1&y=2"],
  ["GET", "/api/users"],
  ["GET", "/api/users/"],
  ["GET", "/api/users/42"],
  ["GET", "/api/users/42?tab=posts"],
  ["POST", "/api/users"],
  ["POST", "/api/users/42"],
  ["HEAD", "/api/users/42"],
  ["GET", "/api/users/42/boom"],
  ["GET", "/api/admin/stats"],
  ["GET", "/api/admin/fail"],
  ["GET", "/api/admin/nope"],
  ["GET", "/api/nope"],
  ["GET", "/apix"],
  ["GET", "/api2/users"],
  ["GET", "/top/7"],
  ["GET", "/top/7/"],
  ["HEAD", "/head-only"],
  ["GET", "/nowhere?x=1"],
  ["GET", "/api/users/%E2%9C%93"],
];

describe("Phase 8 wire-diff: two-router example app, zonix vs Express 4.22.2", () => {
  let mine: RunningApp;
  let theirs: { port: number; close: () => Promise<void> };
  before(async () => {
    mine = await start(buildZonix());
    const server = buildExpress().listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    theirs = {
      port: (server.address() as { port: number }).port,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  });
  after(async () => {
    await Promise.all([mine.close(), theirs.close()]);
  });

  for (const [method, path] of CORPUS) {
    test(`${method} ${path}`, async () => {
      const [a, b] = await Promise.all([
        fetch(`http://127.0.0.1:${mine.port}${path}`, { method }),
        fetch(`http://127.0.0.1:${theirs.port}${path}`, { method }),
      ]);
      const [bodyA, bodyB] = await Promise.all([a.text(), b.text()]);
      assert.equal(a.status, b.status, "status");
      assert.equal(a.headers.get("content-type"), b.headers.get("content-type"), "content-type");
      assert.equal(a.headers.get("x-api"), b.headers.get("x-api"), "x-api");
      assert.equal(a.headers.get("x-mounted-url"), b.headers.get("x-mounted-url"), "x-mounted-url");
      if (method === "HEAD") {
        assert.equal(bodyA, "");
        assert.equal(a.headers.get("content-length"), b.headers.get("content-length"));
        return;
      }
      assert.equal(a.headers.get("content-length"), b.headers.get("content-length"));
      const isJson = (b.headers.get("content-type") ?? "").includes("json");
      if (isJson) assert.deepEqual(JSON.parse(bodyA), JSON.parse(bodyB), "body");
      else assert.equal(bodyA, bodyB, "body");
    });
  }
});
