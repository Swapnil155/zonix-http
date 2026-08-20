import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { makeApp } from "./helpers.js";

describe("response helpers", () => {
  test("json() sets content-type, content-length and serializes the body", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.json({ hello: "world" }));

    const res = await request(app.server).get("/").expect(200);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(res.headers["content-length"], String(Buffer.byteLength('{"hello":"world"}')));
    assert.deepEqual(res.body, { hello: "world" });
  });

  test("json() counts bytes, not characters, for multi-byte payloads", async () => {
    const app = makeApp();
    const payload = { text: "héllo — ünicode ☃" };
    app.get("/", (_req, res) => res.json(payload));

    const res = await request(app.server).get("/").expect(200);
    assert.equal(
      res.headers["content-length"],
      String(Buffer.byteLength(JSON.stringify(payload), "utf8")),
    );
    assert.deepEqual(res.body, payload);
  });

  test("status() chains and sets the code", async () => {
    const app = makeApp();
    app.post("/", (_req, res) => res.status(201).json({ created: true }));

    await request(app.server).post("/").expect(201, { created: true });
  });

  test("status() rejects out-of-range codes", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.status(999).json({}));

    const res = await request(app.server).get("/").expect(500);
    assert.deepEqual(res.body, { error: "Internal Server Error" });
  });

  test("redirect() defaults to 302", async () => {
    const app = makeApp();
    app.get("/old", (_req, res) => res.redirect("/new"));

    const res = await request(app.server).get("/old").expect(302);
    assert.equal(res.headers["location"], "/new");
  });

  test("redirect() honours an explicit code", async () => {
    const app = makeApp();
    app.get("/old", (_req, res) => res.redirect("/new", 301));

    const res = await request(app.server).get("/old").expect(301);
    assert.equal(res.headers["location"], "/new");
  });

  test("a second send after headers are sent does not crash the server", async () => {
    const app = makeApp();
    app.get("/twice", (_req, res) => {
      res.status(200).json({ first: true });
      res.status(200).json({ second: true });
    });

    const res = await request(app.server).get("/twice").expect(200);
    assert.deepEqual(res.body, { first: true });

    // The process is still healthy and serving.
    app.get("/after", (_req, res) => res.json({ alive: true }));
    await request(app.server).get("/after").expect(200, { alive: true });
  });
});

describe("request helpers", () => {
  test("query is parsed lazily and cached", async () => {
    const app = makeApp();
    app.get("/search", (req, res) => {
      const first = req.query;
      const second = req.query;
      res.json({ query: first, cached: first === second });
    });

    await request(app.server)
      .get("/search?q=node&limit=10")
      .expect(200, { query: { q: "node", limit: "10" }, cached: true });
  });

  test("an absent query yields an empty object", async () => {
    const app = makeApp();
    app.get("/none", (req, res) =>
      res.json({ query: req.query, empty: Object.keys(req.query).length }),
    );

    await request(app.server).get("/none").expect(200, { query: {}, empty: 0 });
  });

  test("query decodes percent-encoding and plus signs", async () => {
    const app = makeApp();
    app.get("/search", (req, res) => res.json(req.query));

    await request(app.server)
      .get("/search?q=hello%20world&tag=a%2Bb")
      .expect(200, { q: "hello world", tag: "a+b" });
  });

  test("body is undefined until a parser populates it", async () => {
    const app = makeApp();
    app.get("/", (req, res) => res.json({ hasBody: req.body !== undefined }));

    await request(app.server).get("/").expect(200, { hasBody: false });
  });

  test("path excludes the query string", async () => {
    const app = makeApp();
    app.get("/where", (req, res) => res.json({ path: req.path }));

    await request(app.server).get("/where?a=1").expect(200, { path: "/where" });
  });
});
