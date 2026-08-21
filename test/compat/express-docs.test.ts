/**
 * Phase 6 exit test: handlers copy-pasted from the Express documentation run
 * unmodified.
 *
 * The corpus lives in `docs-routes.ts` and is shared with
 * `express-differential.test.ts`, which runs the identical handlers on real
 * Express and compares the wire bytes. This file is the readable half — it
 * states what each response should be, so a reader can see the surface without
 * running two servers. The differential is the half that cannot be fooled.
 *
 * Assertions here were corrected by the oracle more than once (see
 * `req.is` below). Where the two disagree, the differential wins.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import zonix, { parseJSON, type Zonix } from "../../lib/index.js";
import { start, type RunningApp } from "../helpers/make-app.js";
import { trapUnhandledRejections } from "../helpers/tripwire.js";
import { registerDocsRoutes } from "./docs-routes.js";

const tripwire = trapUnhandledRejections();

let server: RunningApp;

before(async () => {
  const app: Zonix = zonix({ dev: false, cookieSecret: "docs-secret" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerDocsRoutes(app as any, parseJSON());

  // `res.location("back")` is Express 4 only — Express 5 removed it — so it is
  // not in the shared corpus, but CLAUDE.md Phase 6 lists it as in scope.
  app.get("/location/back", (_req, res) => {
    res.location("back");
    res.end();
  });

  server = await start(app);
});

after(async () => {
  await server.close();
  assert.deepEqual(tripwire.reasons, [], "no rejection may escape");
  tripwire.restore();
});

const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${server.url}${path}`, { headers, redirect: "manual" });

describe("Phase 6 exit: Express doc handlers, unmodified", () => {
  test("hello world", async () => {
    const res = await get("/");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "Hello World!");
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  });

  test("route parameters: res.send(req.params)", async () => {
    const res = await get("/users/34/books/8989");
    assert.deepEqual(await res.json(), { userId: "34", bookId: "8989" });
  });

  test("res.send inference matrix", async () => {
    const buffer = await get("/send/buffer");
    assert.equal(buffer.headers.get("content-type"), "application/octet-stream");
    assert.equal(await buffer.text(), "whoop");

    const json = await get("/send/json");
    assert.equal(json.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await json.json(), { some: "json" });

    const html = await get("/send/html");
    assert.equal(html.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await html.text(), "<p>some html</p>");

    const notFound = await get("/send/404");
    assert.equal(notFound.status, 404);
    assert.equal(await notFound.text(), "Sorry, we cannot find that!");

    const failed = await get("/send/500");
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "something blew up" });
  });

  test("res.json", async () => {
    assert.equal(await (await get("/json/null")).text(), "null");
    assert.deepEqual(await (await get("/json/user")).json(), { user: "tobi" });
    const failed = await get("/json/error");
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "message" });
  });

  test("res.set, single field and object form", async () => {
    // res.set appends the charset for types that want one, exactly as Express
    // does — the doc snippet shows the call, not the resulting header.
    const one = await get("/set/one");
    assert.equal(one.headers.get("content-type"), "text/plain; charset=utf-8");

    const many = await get("/set/many");
    assert.equal(many.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(many.headers.get("etag"), "12345");
    assert.equal(many.headers.get("content-length"), "123");
  });

  test("res.append, including the array form", async () => {
    const res = await get("/append");
    assert.equal(res.headers.get("link"), "<http://localhost/>, <http://localhost:3000/>");
    assert.equal(res.headers.get("warning"), "199 Miscellaneous warning");
    assert.ok(res.headers.getSetCookie().includes("foo=bar; Path=/; HttpOnly"));
  });

  test("res.cookie with options", async () => {
    const res = await get("/cookie/basic");
    const cookies = res.headers.getSetCookie();
    assert.ok(
      cookies.some((c) => c.includes("name=tobi") && c.includes("Domain=.example.com")),
      cookies.join(" | "),
    );
    assert.ok(cookies.some((c) => c.includes("Path=/admin") && c.includes("Secure")));
    assert.ok(cookies.some((c) => c.includes("rememberme=1") && c.includes("HttpOnly")));
    assert.ok(cookies.some((c) => c.includes("Expires=")));
  });

  test("res.cookie with an object value uses Express's j: form", async () => {
    const res = await get("/cookie/object");
    const cookies = res.headers.getSetCookie();
    const cart = cookies.find((c) => c.startsWith("cart="));
    assert.ok(cart, cookies.join(" | "));
    const value = cart.slice("cart=".length).split(";")[0] ?? "";
    assert.equal(decodeURIComponent(value), 'j:{"items":[1,2,3]}');
    assert.ok(cookies.some((c) => c.startsWith("cart2=") && c.includes("Max-Age=900")));
  });

  test("res.cookie({ signed: true })", async () => {
    const res = await get("/cookie/signed");
    const cookie = res.headers.getSetCookie()[0] ?? "";
    assert.ok(cookie.startsWith("name=s%3Atobi."), cookie);
  });

  test("res.clearCookie", async () => {
    const res = await get("/cookie/clear");
    const cleared = res.headers.getSetCookie().find((c) => c.includes("Expires=Thu, 01 Jan 1970"));
    assert.ok(cleared, res.headers.getSetCookie().join(" | "));
    assert.ok(cleared.includes("Path=/admin"));
  });

  test("res.location", async () => {
    assert.equal((await get("/location/path")).headers.get("location"), "/foo/bar");
    assert.equal((await get("/location/absolute")).headers.get("location"), "http://example.com");
  });

  test('res.location("back") resolves the Referer [Express 4 only]', async () => {
    assert.equal(
      (await get("/location/back", { Referer: "/previous" })).headers.get("location"),
      "/previous",
    );
    assert.equal((await get("/location/back")).headers.get("location"), "/");
  });

  test("res.redirect, including the status-first overload", async () => {
    const path = await get("/redirect/path");
    assert.equal(path.status, 302);
    assert.equal(path.headers.get("location"), "/foo/bar");

    const absolute = await get("/redirect/absolute");
    assert.equal(absolute.headers.get("location"), "http://example.com");

    // Express's documented `res.redirect([status,] path)` overload. Its absence
    // was the first thing this exit test caught.
    const statusFirst = await get("/redirect/status-first");
    assert.equal(statusFirst.status, 301);
    assert.equal(statusFirst.headers.get("location"), "http://example.com");

    const relative = await get("/redirect/relative");
    assert.equal(relative.headers.get("location"), "../login");
  });

  test("res.type, all five documented forms", async () => {
    const seen = (await (await get("/type")).json()) as string[];
    assert.deepEqual(seen, [
      "text/html; charset=utf-8",
      "text/html; charset=utf-8",
      "application/json; charset=utf-8",
      "application/json; charset=utf-8",
      // No charset: image/png is not a type that carries one.
      "image/png",
    ]);
  });

  test("res.sendStatus", async () => {
    const ok = await get("/status/200");
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "OK");
    assert.equal((await get("/status/403")).status, 403);
    assert.equal(await (await get("/status/404")).text(), "Not Found");
    assert.equal(await (await get("/status/500")).text(), "Internal Server Error");
  });

  test("res.links", async () => {
    assert.equal(
      (await get("/links")).headers.get("link"),
      '<http://api.example.com/users?page=2>; rel="next", ' +
        '<http://api.example.com/users?page=5>; rel="last"',
    );
  });

  test("res.vary", async () => {
    assert.equal((await get("/vary")).headers.get("vary"), "User-Agent");
  });

  test("res.locals set by middleware reach the handler", async () => {
    assert.deepEqual(await (await get("/locals")).json(), {
      user: { name: "tobi" },
      authenticated: true,
    });
  });

  test("req.get and req.is", async () => {
    const res = await fetch(`${server.url}/req/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.deepEqual(await res.json(), {
      contentType: "application/json",
      lowercase: "application/json",
      missing: null,
      isHtml: false,
      isJson: "json",
      isApplicationJson: "application/json",
      // The Express docs claim `req.is('application/*')` returns
      // `'application/*'`. It does not: `type-is` returns the *matched* type for
      // wildcard patterns, and the differential test confirms real Express
      // returns "application/json". The oracle outranks the docs.
      isApplicationStar: "application/json",
    });
  });

  test("req.path, req.originalUrl, req.query", async () => {
    assert.deepEqual(await (await get("/search?q=tobi+ferret")).json(), {
      path: "/search",
      originalUrl: "/search?q=tobi+ferret",
      q: "tobi ferret",
    });
  });

  test("req.protocol, req.secure, req.hostname, req.xhr", async () => {
    const res = await get("/req/env", { "X-Requested-With": "XMLHttpRequest" });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.protocol, "http");
    assert.equal(body.secure, false);
    assert.equal(body.hostname, "127.0.0.1");
    assert.equal(body.xhr, true);
    assert.equal(body.method, "GET");
  });

  test("express.json equivalent: req.body round-trips", async () => {
    const res = await fetch(`${server.url}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "tobi", tags: ["a", "b"] }),
    });
    assert.deepEqual(await res.json(), { title: "tobi", tags: ["a", "b"] });
  });
});
