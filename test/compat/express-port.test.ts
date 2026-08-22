/**
 * The Phase 8 exit test: a real Express application (JSON + form bodies, two
 * mounted routers with one nested, params/query, static files, a scoped
 * auth middleware, router- and app-level error middleware, a catch-all 404)
 * ported to zonix by changing ONLY its import line — asserted textually —
 * then both run side by side and diffed on the wire for a request corpus.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/* eslint-disable @typescript-eslint/no-explicit-any */
const dir = fileURLToPath(new URL("./express-port/", import.meta.url));
const staticDir = mkdtempSync(join(tmpdir(), "zonix-port-static-"));
mkdirSync(join(staticDir, "css"));
writeFileSync(join(staticDir, "css", "site.css"), "body{color:red}\n");
writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>assets</title>\n");
writeFileSync(join(staticDir, "data.json"), '{"static":true}\n');

interface Probe {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

const JSON_H = { "content-type": "application/json" };
const FORM_H = { "content-type": "application/x-www-form-urlencoded" };
const CORPUS: Probe[] = [
  { method: "GET", path: "/" },
  { method: "GET", path: "/health" },
  { method: "HEAD", path: "/health" },
  { method: "GET", path: "/api/users" },
  { method: "GET", path: "/api/users/" },
  { method: "GET", path: "/api/users?limit=1" },
  { method: "GET", path: "/api/users?limit=abc" },
  { method: "GET", path: "/api/users/1" },
  { method: "GET", path: "/api/users/2" },
  { method: "GET", path: "/api/users/99" },
  { method: "POST", path: "/api/users", headers: JSON_H, body: '{"name":"Linus"}' },
  { method: "POST", path: "/api/users", headers: JSON_H, body: '{"name":""}' },
  { method: "POST", path: "/api/users", headers: JSON_H, body: "{}" },
  { method: "POST", path: "/api/users", headers: JSON_H, body: "not json" },
  { method: "POST", path: "/api/users", headers: FORM_H, body: "name=Form+Name" },
  {
    method: "POST",
    path: "/api/users/form",
    headers: FORM_H,
    body: "a[b]=1&a[c][]=2&a[c][]=3&d=x",
  },
  { method: "POST", path: "/api/users/form", headers: FORM_H, body: "" },
  { method: "GET", path: "/api/users/1/extra" },
  { method: "GET", path: "/api/admin/stats" },
  { method: "GET", path: "/api/admin/stats", headers: { "x-api-key": "secret" } },
  { method: "GET", path: "/api/admin/stats?x=1", headers: { "x-api-key": "nope" } },
  { method: "GET", path: "/api/admin/boom", headers: { "x-api-key": "secret" } },
  { method: "GET", path: "/api/admin/nope", headers: { "x-api-key": "secret" } },
  { method: "GET", path: "/api/echo?a=1&b[c]=2&b[d][]=3&b[d][]=4" },
  { method: "GET", path: "/api/echo" },
  { method: "GET", path: "/api" },
  { method: "GET", path: "/api/" },
  { method: "GET", path: "/apix" },
  { method: "GET", path: "/api/users/1/" },
  { method: "POST", path: "/echo", headers: JSON_H, body: '{"a":[1,2,{"b":null}]}' },
  { method: "POST", path: "/echo", headers: FORM_H, body: "x=1&y[z]=2" },
  { method: "POST", path: "/echo", headers: { "content-type": "text/plain" }, body: "plain" },
  { method: "POST", path: "/echo", headers: JSON_H, body: "x".repeat(17_000) },
  { method: "GET", path: "/assets/css/site.css" },
  { method: "GET", path: "/assets/data.json" },
  { method: "GET", path: "/assets/" },
  { method: "GET", path: "/assets/missing.css" },
  { method: "GET", path: "/assets/../package.json" },
  { method: "GET", path: "/nowhere" },
  { method: "DELETE", path: "/api/users/1" },
  { method: "PUT", path: "/health" },
];

describe("Phase 8 exit: an Express app ported by its import line alone", () => {
  test("the two sources differ in line 1 only", () => {
    const a = readFileSync(join(dir, "app.express.mjs"), "utf8").split("\n");
    const b = readFileSync(join(dir, "app.zonix.mjs"), "utf8").split("\n");
    assert.equal(a[0], 'import express from "express";');
    assert.equal(b[0], 'import express from "../../../lib/index.js";');
    assert.deepEqual(a.slice(1), b.slice(1));
    assert.ok(a.length > 80, "a real app, not a toy");
  });

  test("deviation: Express 4 defaults `query parser` to extended, zonix (like Express 5) to simple", async () => {
    const { createRequire } = await import("node:module");
    const express = createRequire(import.meta.url)("express") as any;
    const zonix = (await import("../../lib/index.js")).default;
    const ex = express();
    ex.get("/q", (req: any, res: any) => res.json(req.query));
    const zx = zonix({ dev: false });
    zx.get("/q", (req, res) => res.json(req.query));
    const es = ex.listen(0, "127.0.0.1");
    const zs = zx.listen(0, "127.0.0.1");
    await Promise.all([
      new Promise<void>((r) => es.once("listening", () => r())),
      new Promise<void>((r) => zs.once("listening", () => r())),
    ]);
    try {
      const get = async (s: any) =>
        (await fetch(`http://127.0.0.1:${s.address().port}/q?a[b]=1`)).json();
      assert.deepEqual(await get(es), { a: { b: "1" } });
      assert.deepEqual(await get(zs), { "a[b]": "1" });
    } finally {
      es.close();
      zs.closeAllConnections();
      zs.close();
    }
  });

  let mine: { port: number; close: () => Promise<void> };
  let theirs: { port: number; close: () => Promise<void> };

  async function listen(file: string): Promise<{ port: number; close: () => Promise<void> }> {
    const mod = (await import(new URL(file, new URL("./express-port/", import.meta.url)).href)) as {
      createApp: (o: { staticDir: string }) => any;
    };
    const app = mod.createApp({ staticDir });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    return {
      port: (server.address() as { port: number }).port,
      close: () =>
        new Promise<void>((r) => {
          server.closeAllConnections?.();
          server.close(() => r());
        }),
    };
  }

  before(async () => {
    [theirs, mine] = await Promise.all([listen("app.express.mjs"), listen("app.zonix.mjs")]);
  });
  after(async () => {
    await Promise.all([mine.close(), theirs.close()]);
  });

  async function send(port: number, p: Probe) {
    const r = await fetch(`http://127.0.0.1:${port}${p.path}`, {
      method: p.method,
      headers: p.headers ?? {},
      body: p.body,
      redirect: "manual",
    });
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      location: r.headers.get("location"),
      version: r.headers.get("x-api-version"),
      length: r.headers.get("content-length"),
      body: await r.text(),
    };
  }

  for (const p of CORPUS) {
    test(`${p.method} ${p.path}${p.body ? ` ${JSON.stringify(p.body.slice(0, 30))}` : ""}`, async () => {
      // Sequential so the in-memory "db" sees the same mutation order on both.
      const b = await send(theirs.port, p);
      const a = await send(mine.port, p);
      assert.equal(a.status, b.status, `status (theirs: ${b.body.slice(0, 120)})`);
      // `charset=UTF-8` (send/serve-static) vs `charset=utf-8`: equal by RFC, compared as such.
      assert.equal(a.type?.toLowerCase(), b.type?.toLowerCase(), "content-type");
      assert.equal(a.location, b.location, "location");
      assert.equal(a.version, b.version, "x-api-version");
      if (p.method === "HEAD") {
        assert.equal(a.body, "");
        assert.equal(a.length, b.length, "content-length");
        return;
      }
      if (a.status === 400 && p.body === "not json") {
        // Both answer 400 through the app's error handler; the JSON parser's
        // message text is implementation-specific, so only the shape is held.
        assert.match(a.body, /"error"/);
        assert.match(b.body, /"error"/);
        return;
      }
      if (a.status === 413) {
        assert.match(a.body, /"error"/);
        return;
      }
      if ((b.type ?? "").includes("json")) {
        assert.deepEqual(JSON.parse(a.body), JSON.parse(b.body), "json body");
      } else {
        assert.equal(a.body, b.body, "body");
      }
      assert.equal(a.length, b.length, "content-length");
    });
  }
});
