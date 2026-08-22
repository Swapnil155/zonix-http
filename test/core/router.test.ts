import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import type { Handler } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";

/** Echo the matched route id plus whatever params were captured. */
const echo =
  (id: string): Handler =>
  (req, res) =>
    res.status(200).json({ id, params: req.params });

describe("router: matching", () => {
  test("matches a static path", async () => {
    const app = makeApp();
    app.get("/health", echo("health"));

    await request(app.server).get("/health").expect(200, { id: "health", params: {} });
  });

  test("matches the root path", async () => {
    const app = makeApp();
    app.get("/", echo("root"));

    await request(app.server).get("/").expect(200, { id: "root", params: {} });
  });

  test("captures a single param", async () => {
    const app = makeApp();
    app.get("/users/:id", echo("user"));

    await request(app.server)
      .get("/users/42")
      .expect(200, { id: "user", params: { id: "42" } });
  });

  test("captures multiple params across depths", async () => {
    const app = makeApp();
    app.get("/orgs/:org/repos/:repo/issues/:number", echo("issue"));

    await request(app.server)
      .get("/orgs/acme/repos/zonix/issues/7")
      .expect(200, {
        id: "issue",
        params: { org: "acme", repo: "zonix", number: "7" },
      });
  });

  test("captures the tail into params['*']", async () => {
    const app = makeApp();
    app.get("/files/*", echo("files"));

    await request(app.server)
      .get("/files/img/logo.png")
      .expect(200, { id: "files", params: { "*": "img/logo.png" } });
  });

  test("a wildcard matches an empty tail", async () => {
    const app = makeApp();
    app.get("/files/*", echo("files"));

    await request(app.server)
      .get("/files")
      .expect(200, { id: "files", params: { "*": "" } });
  });

  test("methods are isolated: POST /x does not match GET /x", async () => {
    const app = makeApp();
    app.get("/x", echo("get-x"));

    await request(app.server).get("/x").expect(200);
    await request(app.server).post("/x").expect(404);
  });

  test("the method is matched case-insensitively at registration", async () => {
    const app = makeApp();
    app.route("GET", "/loud", echo("loud"));

    await request(app.server).get("/loud").expect(200, { id: "loud", params: {} });
  });

  test("paths are matched case-sensitively", async () => {
    const app = makeApp();
    app.get("/Users", echo("upper"));

    await request(app.server).get("/Users").expect(200);
    await request(app.server).get("/users").expect(404);
  });

  test("unmatched paths 404 with the method and path", async () => {
    const app = makeApp();
    app.get("/known", echo("known"));

    const res = await request(app.server).get("/unknown").expect(404);
    assert.deepEqual(res.body, { error: "Cannot GET /unknown" });
  });
});

describe("router: priority and backtracking", () => {
  test("a static segment beats a param at the same depth", async () => {
    const app = makeApp();
    app.get("/users/:id", echo("param"));
    app.get("/users/me", echo("static"));

    await request(app.server).get("/users/me").expect(200, { id: "static", params: {} });
    await request(app.server)
      .get("/users/9")
      .expect(200, { id: "param", params: { id: "9" } });
  });

  test("a param beats a wildcard at the same depth", async () => {
    const app = makeApp();
    app.get("/files/*", echo("wild"));
    app.get("/files/:name", echo("param"));

    await request(app.server)
      .get("/files/report.pdf")
      .expect(200, { id: "param", params: { name: "report.pdf" } });
    await request(app.server)
      .get("/files/2024/report.pdf")
      .expect(200, { id: "wild", params: { "*": "2024/report.pdf" } });
  });

  test("backtracks to the param branch when the static branch dead-ends", async () => {
    const app = makeApp();
    app.get("/foo/bar", echo("static-branch"));
    app.get("/:name/baz", echo("param-branch"));

    // "foo" matches the static child, but "/foo/baz" only exists under the param branch.
    await request(app.server)
      .get("/foo/baz")
      .expect(200, { id: "param-branch", params: { name: "foo" } });
    await request(app.server).get("/foo/bar").expect(200, { id: "static-branch", params: {} });
  });

  test("backtracks from a param branch down to a wildcard", async () => {
    const app = makeApp();
    app.get("/a/:b/c", echo("param-branch"));
    app.get("/a/*", echo("wild"));

    await request(app.server)
      .get("/a/x/c")
      .expect(200, { id: "param-branch", params: { b: "x" } });
    await request(app.server)
      .get("/a/x/d")
      .expect(200, { id: "wild", params: { "*": "x/d" } });
  });

  test("distinct param names may share a slot across routes", async () => {
    const app = makeApp();
    app.get("/:id/profile", echo("profile"));
    app.get("/:username/settings", echo("settings"));

    await request(app.server)
      .get("/42/profile")
      .expect(200, { id: "profile", params: { id: "42" } });
    await request(app.server)
      .get("/swapnil/settings")
      .expect(200, { id: "settings", params: { username: "swapnil" } });
  });
});

describe("router: normalization", () => {
  test("a trailing slash on the request matches the route without one", async () => {
    const app = makeApp();
    app.get("/users", echo("users"));

    await request(app.server).get("/users/").expect(200, { id: "users", params: {} });
  });

  test("a trailing slash at registration matches a request without one", async () => {
    const app = makeApp();
    app.get("/users/", echo("users"));

    await request(app.server).get("/users").expect(200, { id: "users", params: {} });
  });

  test("registering both slash forms is a duplicate", () => {
    const app = makeApp();
    app.get("/users", echo("a"));
    assert.throws(() => app.get("/users/", echo("b")), /Duplicate route/);
  });

  test("the query string is not part of the match", async () => {
    const app = makeApp();
    app.get("/search", (req, res) => res.json({ q: req.query["q"] ?? null }));

    await request(app.server).get("/search?q=radix").expect(200, { q: "radix" });
  });

  test("percent-encoded segments are decoded into params", async () => {
    const app = makeApp();
    app.get("/users/:name", echo("user"));

    await request(app.server)
      .get("/users/a%20b")
      .expect(200, { id: "user", params: { name: "a b" } });
  });

  test("a percent-encoded static segment matches its literal route", async () => {
    const app = makeApp();
    app.get("/hello world", echo("spaced"));

    await request(app.server).get("/hello%20world").expect(200, { id: "spaced", params: {} });
  });

  test("an encoded slash stays inside one param", async () => {
    const app = makeApp();
    app.get("/files/:name", echo("file"));

    await request(app.server)
      .get("/files/a%2Fb")
      .expect(200, { id: "file", params: { name: "a/b" } });
  });

  test("malformed percent-encoding is a 400, not a crash", async () => {
    const app = makeApp();
    app.get("/users/:name", echo("user"));

    const res = await request(app.server).get("/users/%E0%A4%A").expect(400);
    assert.match(String(res.body.error), /decode/i);

    // Still serving afterwards.
    await request(app.server).get("/users/ok").expect(200);
  });
});

describe("router: registration errors", () => {
  test("duplicate registration throws", () => {
    const app = makeApp();
    app.get("/dup", echo("first"));
    assert.throws(() => app.get("/dup", echo("second")), /Duplicate route/);
  });

  test("the same path under different methods is not a duplicate", () => {
    const app = makeApp();
    app.get("/thing", echo("get"));
    assert.doesNotThrow(() => app.post("/thing", echo("post")));
  });

  test("a named wildcard is rejected", () => {
    const app = makeApp();
    assert.throws(() => app.get("/files/*splat", echo("x")), /wildcard/i);
  });

  test("a wildcard before the final segment is rejected", () => {
    const app = makeApp();
    assert.throws(() => app.get("/files/*/meta", echo("x")), /final segment/i);
  });

  test("an empty param name is rejected", () => {
    const app = makeApp();
    assert.throws(() => app.get("/users/:", echo("x")), /param/i);
  });

  test("duplicate param names in one route are rejected", () => {
    const app = makeApp();
    assert.throws(() => app.get("/a/:id/b/:id", echo("x")), /duplicate param/i);
  });

  test("a path that does not start with a slash is rejected", () => {
    const app = makeApp();
    assert.throws(() => app.get("users", echo("x")), /must start/);
  });
});

describe("router: fallback", () => {
  test("fallback replaces the default 404", async () => {
    const app = makeApp();
    app.get("/known", echo("known"));
    app.fallback((req, res) => res.status(404).json({ missing: req.path }));

    await request(app.server).get("/nope").expect(404, { missing: "/nope" });
  });

  test("fallback does not run when a route matches", async () => {
    let ran = false;
    const app = makeApp();
    app.get("/known", echo("known"));
    app.fallback((_req, res) => {
      ran = true;
      res.status(404).end();
    });

    await request(app.server).get("/known").expect(200);
    assert.equal(ran, false);
  });

  test("only one fallback may be registered", () => {
    const app = makeApp();
    app.fallback((_req, res) => res.status(404).end());
    assert.throws(() => app.fallback((_req, res) => res.status(404).end()), /already registered/);
  });
});

describe("router: params object shape", () => {
  test("params is a plain fast-shape object carrying only the captured keys", async () => {
    const app = makeApp();
    app.get("/users/:id/posts/:post", (req, res) => {
      const p = req.params;
      res.status(200).json({
        own: Object.keys(p),
        hasOwnProto: Object.prototype.hasOwnProperty.call(p, "__proto__"),
        id: p.id,
        post: p.post,
      });
    });
    await request(app.server)
      .get("/users/7/posts/9")
      .expect(200, { own: ["id", "post"], hasOwnProto: false, id: "7", post: "9" });
  });

  test("prototype-reaching param names are rejected at registration", () => {
    const app = makeApp();
    for (const name of ["__proto__", "constructor", "prototype"]) {
      assert.throws(() => app.get(`/x/:${name}`, echo("x")), /not an allowed param name/);
    }
    assert.throws(() => app.get("/y/:a/:constructor", echo("y")), /not an allowed param name/);
  });

  test("a literal path segment named like a prototype key still routes statically", async () => {
    const app = makeApp();
    app.get("/__proto__/:id", echo("proto-static"));
    await request(app.server)
      .get("/__proto__/3")
      .expect(200, { id: "proto-static", params: { id: "3" } });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

describe("router: HEAD falls back to GET", () => {
  test("a GET route answers HEAD with the same headers and no body", async () => {
    const app = makeApp();
    app.get("/thing", (_req, res) => res.status(200).json({ big: "x".repeat(100) }));
    const res = await request(app.server).head("/thing").expect(200);
    assert.equal(res.headers["content-length"], "110");
    assert.equal(res.text, undefined);
  });

  test("an explicit HEAD route wins over the GET fallback", async () => {
    const app = makeApp();
    app.get("/thing", (_req, res) => res.status(200).json({ via: "get" }));
    app.route("head", "/thing", (_req, res) => res.status(204).end());
    await request(app.server).head("/thing").expect(204);
    await request(app.server).get("/thing").expect(200, { via: "get" });
  });

  test("HEAD on a path with no GET route is still a 404", async () => {
    const app = makeApp();
    app.get("/thing", echo("thing"));
    await request(app.server).head("/other").expect(404);
  });
});
