/**
 * Phase 8: `zonix.Router()`, path-mounted `use`, nesting, url rewrite with
 * `originalUrl`/`baseUrl`, four-arity error middleware before `handleErr`,
 * HEAD fallback through mounts, and the `maxParamLength` 414 guard.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import zonix, { ErrorCode, Router, type Zonix, type ZonixError } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import { trapUnhandledRejections } from "../helpers/tripwire.js";

const trap = trapUnhandledRejections();
process.on("exit", () => {
  trap.restore();
  assert.deepEqual(trap.reasons, []);
});

/** Echo the request's view of itself from wherever the handler sits. */
const where = (label: string) => (req: any, res: any) =>
  res.json({
    label,
    url: req.url,
    path: req.path,
    baseUrl: req.baseUrl,
    originalUrl: req.originalUrl,
    params: req.params,
    query: req.query,
  });

describe("Router: construction and registration", () => {
  test("Router() works with and without new, and hangs off the default export", () => {
    assert.ok(Router() instanceof Router);
    assert.ok(new Router() instanceof Router);
    assert.equal(zonix.Router, Router);
  });

  test("mount paths must be static prefixes", () => {
    const app = makeApp();
    const r = Router();
    assert.throws(() => app.use("api", r), { code: ErrorCode.INVALID_ROUTE });
    assert.throws(() => app.use("/users/:id", r), { code: ErrorCode.INVALID_ROUTE });
    assert.throws(() => app.use("/files/*", r), { code: ErrorCode.INVALID_ROUTE });
    assert.throws(() => app.use("/api"), { code: ErrorCode.INVALID_ARGUMENT });
    assert.throws(() => app.use("/api", {} as never), { code: ErrorCode.INVALID_ARGUMENT });
    assert.throws(() => r.use("/x"), { code: ErrorCode.INVALID_ARGUMENT });
    assert.throws(() => r.get("nope", () => {}), { code: ErrorCode.INVALID_ROUTE });
  });

  test("maxParamLength must be a non-negative number", () => {
    assert.throws(() => zonix({ maxParamLength: -1 }), { code: ErrorCode.INVALID_ARGUMENT });
    assert.throws(() => zonix({ maxParamLength: Number.NaN }), {
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });
});

describe("mount / nest matrix", () => {
  function build(): Zonix {
    const app = makeApp();
    const users = Router();
    users.get("/", where("users.index"));
    users.get("/:id", where("users.show"));
    users.post("/", where("users.create"));
    const admin = Router();
    admin.get("/stats", where("admin.stats"));
    const api = Router();
    api.use("/users", users);
    api.use("/admin", admin);
    api.get("/", where("api.root"));
    api.get("/ping", where("api.ping"));
    app.use("/api", api);
    app.get("/", where("app.root"));
    app.get("/top/:id", where("app.top"));
    return app;
  }

  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["GET /", "/", { label: "app.root", url: "/", path: "/", baseUrl: "", originalUrl: "/" }],
    [
      "GET /api",
      "/api",
      { label: "api.root", url: "/", path: "/", baseUrl: "/api", originalUrl: "/api" },
    ],
    [
      "GET /api/",
      "/api/",
      { label: "api.root", url: "/", path: "/", baseUrl: "/api", originalUrl: "/api/" },
    ],
    ["GET /api/ping", "/api/ping", { label: "api.ping", url: "/ping", baseUrl: "/api" }],
    [
      "GET /api/users",
      "/api/users",
      {
        label: "users.index",
        url: "/",
        path: "/",
        baseUrl: "/api/users",
        originalUrl: "/api/users",
      },
    ],
    [
      "GET /api/users/42?x=1",
      "/api/users/42?x=1",
      {
        label: "users.show",
        url: "/42?x=1",
        path: "/42",
        baseUrl: "/api/users",
        originalUrl: "/api/users/42?x=1",
        params: { id: "42" },
        query: { x: "1" },
      },
    ],
    [
      "GET /api/admin/stats",
      "/api/admin/stats",
      {
        label: "admin.stats",
        url: "/stats",
        baseUrl: "/api/admin",
        originalUrl: "/api/admin/stats",
      },
    ],
    ["GET /top/7", "/top/7", { label: "app.top", baseUrl: "", params: { id: "7" } }],
  ];

  for (const [name, path, expected] of cases) {
    test(`${name} → ${String(expected["label"])}`, async () => {
      const app = build();
      const res = await request(app.server).get(path).expect(200);
      for (const [k, v] of Object.entries(expected)) assert.deepEqual(res.body[k], v, k);
    });
  }

  test("POST reaches the nested router's POST route, and only it", async () => {
    const app = build();
    const res = await request(app.server).post("/api/users").expect(200);
    assert.equal(res.body.label, "users.create");
    await request(app.server).post("/api/users/42").expect(404);
  });

  test("prefix matching is segment-aligned: /apix and /api2 are misses", async () => {
    const app = build();
    await request(app.server).get("/apix").expect(404);
    await request(app.server).get("/api2/users").expect(404);
    await request(app.server).get("/api/usersx").expect(404);
  });

  test("a mounted miss falls through to later app routes and then the 404", async () => {
    const app = build();
    app.get("/api/extra", where("app.extra"));
    const res = await request(app.server).get("/api/extra").expect(200);
    assert.equal(res.body.label, "app.extra");
    assert.equal(res.body.baseUrl, "");
    assert.equal(res.body.url, "/api/extra");
    const miss = await request(app.server).get("/api/nothing").expect(404);
    assert.deepEqual(miss.body, { error: "Cannot GET /api/nothing" });
  });

  test("url and baseUrl are restored after a mounted layer calls next()", async () => {
    const app = makeApp();
    const seen: string[] = [];
    app.use("/api", (req, _res, next) => {
      seen.push(`in:${req.url}:${req.baseUrl}`);
      next();
    });
    app.use((req, _res, next) => {
      seen.push(`after:${req.url}:${req.baseUrl}`);
      next();
    });
    app.get("/api/x", where("x"));
    const res = await request(app.server).get("/api/x?q=1").expect(200);
    assert.deepEqual(seen, ["in:/x?q=1:/api", "after:/api/x?q=1:"]);
    assert.equal(res.body.url, "/api/x?q=1");
    assert.equal(res.body.baseUrl, "");
  });

  test("a prefixed plain middleware guards routes under it (registration order kept)", async () => {
    const app = makeApp();
    const order: string[] = [];
    app.use((_req, _res, next) => {
      order.push("global");
      next();
    });
    app.use("/admin", (_req, res, next) => {
      order.push("auth");
      if (!_req.headers["x-admin"]) return res.status(401).json({ error: "auth" });
      next();
    });
    app.use((_req, _res, next) => {
      order.push("late-global");
      next();
    });
    app.get("/admin/secret", (_req, res) => res.json({ secret: true }));
    app.get("/public", (_req, res) => res.json({ ok: true }));

    await request(app.server).get("/admin/secret").expect(401);
    assert.deepEqual(order, ["global", "auth"]);
    order.length = 0;
    await request(app.server)
      .get("/admin/secret")
      .set("x-admin", "1")
      .expect(200, { secret: true });
    assert.deepEqual(order, ["global", "auth", "late-global"]);
    order.length = 0;
    await request(app.server).get("/public").expect(200);
    assert.deepEqual(order, ["global", "late-global"]);
  });

  test("a router mounted at / and router-level use() run in order, then the route chain", async () => {
    const app = makeApp();
    const r = Router();
    const order: string[] = [];
    r.use((_req, _res, next) => {
      order.push("r.use");
      next();
    });
    r.use("/sub", (_req, _res, next) => {
      order.push("r.use(/sub)");
      next();
    });
    r.get(
      "/sub/x",
      (_req, _res, next) => {
        order.push("route-mw");
        next();
      },
      (_req, res) => {
        order.push("handler");
        res.json({ ok: true });
      },
    );
    app.use(r);
    await request(app.server).get("/sub/x").expect(200);
    assert.deepEqual(order, ["r.use", "r.use(/sub)", "route-mw", "handler"]);
    order.length = 0;
    await request(app.server).get("/other").expect(404);
    assert.deepEqual(order, ["r.use"]);
  });

  test("the same router can be mounted twice", async () => {
    const app = makeApp();
    const r = Router();
    r.get("/", where("r"));
    app.use("/a", r);
    app.use("/b", r);
    assert.equal((await request(app.server).get("/a").expect(200)).body.baseUrl, "/a");
    assert.equal((await request(app.server).get("/b").expect(200)).body.baseUrl, "/b");
  });

  test("params under a mount are the router's own; app params are unaffected", async () => {
    const app = makeApp();
    const r = Router();
    r.get("/:rid", where("r"));
    app.use("/things", r);
    app.get("/things/:tid/extra", where("app"));
    const a = await request(app.server).get("/things/1").expect(200);
    assert.deepEqual(a.body.params, { rid: "1" });
    const b = await request(app.server).get("/things/1/extra").expect(200);
    assert.deepEqual(b.body.params, { tid: "1" });
  });

  test("a bad percent-encoding under a mount is still a 400", async () => {
    const app = makeApp();
    const r = Router();
    r.get("/:id", where("r"));
    app.use("/api", r);
    await request(app.server).get("/api/%E0%A4%A").expect(400);
  });
});

describe("HEAD falls back to GET through mounts", () => {
  test("nested router GET answers HEAD with headers only; explicit HEAD wins", async () => {
    const app = makeApp();
    const inner = Router();
    inner.get("/doc", (_req, res) => res.send("hello world"));
    inner.get("/both", (_req, res) => res.set("x-from", "get").send("get"));
    inner.head("/both", (_req, res) => res.set("x-from", "head").end());
    const outer = Router();
    outer.use("/inner", inner);
    app.use("/api", outer);

    const head = await request(app.server).head("/api/inner/doc").expect(200);
    assert.equal(head.headers["content-length"], "11");
    assert.equal(head.text, undefined);
    const explicit = await request(app.server).head("/api/inner/both").expect(200);
    assert.equal(explicit.headers["x-from"], "head");
    await request(app.server).head("/api/inner/nope").expect(404);
  });
});

describe("four-arity error middleware", () => {
  test("runs before handleErr; next(err) passes on; the chain is ordered", async () => {
    const app = makeApp();
    const order: string[] = [];
    app.use((err: ZonixError, _req: any, _res: any, next: any) => {
      order.push(`first:${err.message}`);
      next(new Error("rewrapped"));
    });
    app.use((err: ZonixError, _req: any, _res: any, next: any) => {
      order.push(`second:${err.message}`);
      next(); // same error continues
    });
    app.handleErr((err, _req, res) => {
      order.push(`handleErr:${err.message}`);
      res.status(500).json({ final: err.message });
    });
    app.get("/boom", () => {
      throw new Error("boom");
    });
    app.get("/async", async () => {
      throw new Error("async-boom");
    });
    app.get("/next", (_req, _res, next) => next(new Error("via-next")));

    const r = await request(app.server).get("/boom").expect(500);
    assert.deepEqual(r.body, { final: "rewrapped" });
    assert.deepEqual(order, ["first:boom", "second:rewrapped", "handleErr:rewrapped"]);
    order.length = 0;
    await request(app.server).get("/async").expect(500);
    assert.equal(order[0], "first:async-boom");
    order.length = 0;
    await request(app.server).get("/next").expect(500);
    assert.equal(order[0], "first:via-next");
  });

  test("an error middleware that answers stops the chain; handleErr never sees it", async () => {
    const app = makeApp();
    let central = 0;
    app.use((err: ZonixError, _req: any, res: any, _next: any) => {
      res.status(418).json({ handled: err.message });
    });
    app.handleErr(() => {
      central++;
    });
    app.get("/boom", () => {
      throw new Error("teapot");
    });
    await request(app.server).get("/boom").expect(418, { handled: "teapot" });
    assert.equal(central, 0);
  });

  test("a throwing error middleware hands its own error on; no error → default responder", async () => {
    const app = makeApp();
    app.use((_err: ZonixError, _req: any, _res: any, _next: any) => {
      throw new Error("worse");
    });
    app.use(async (_err: ZonixError, _req: any, _res: any, _next: any) => {
      throw new Error("worst");
    });
    app.get("/boom", () => {
      throw new Error("bad");
    });
    const r = await request(app.server).get("/boom").expect(500);
    assert.deepEqual(r.body, { error: "Internal Server Error" });
    // A client error status is honoured by the default responder even after
    // the layers rewrote it.
    const app2 = makeApp();
    app2.use((_err: ZonixError, _req: any, _res: any, next: any) => {
      const e: ZonixError = new Error("nope");
      e.status = 422;
      next(e);
    });
    app2.get("/boom", () => {
      throw new Error("bad");
    });
    await request(app2.server).get("/boom").expect(422, { error: "nope" });
  });

  test("router-level error middleware runs first, then the app's, then handleErr", async () => {
    const app = makeApp();
    const order: string[] = [];
    const r = Router();
    r.get("/boom", () => {
      throw new Error("r-boom");
    });
    r.get("/handled", () => {
      throw new Error("mine");
    });
    r.use((err: ZonixError, req: any, res: any, next: any) => {
      order.push(`router:${err.message}:${req.baseUrl}`);
      if (err.message === "mine") return res.status(400).json({ router: true });
      next(err);
    });
    app.use("/api", r);
    app.use((err: ZonixError, req: any, _res: any, next: any) => {
      order.push(`app:${err.message}:${req.baseUrl}`);
      next(err);
    });
    app.handleErr((err, _req, res) => {
      order.push("handleErr");
      res.status(500).json({ error: err.message });
    });
    await request(app.server).get("/api/boom").expect(500, { error: "r-boom" });
    assert.deepEqual(order, ["router:r-boom:/api", "app:r-boom:", "handleErr"]);
    order.length = 0;
    await request(app.server).get("/api/handled").expect(400, { router: true });
    assert.deepEqual(order, ["router:mine:/api"]);
  });

  test("a path-scoped error middleware only sees errors under its prefix", async () => {
    const app = makeApp();
    const seen: string[] = [];
    app.use("/api", (err: ZonixError, _req: any, _res: any, next: any) => {
      seen.push(err.message);
      next(err);
    });
    app.get("/api/x", () => {
      throw new Error("in");
    });
    app.get("/y", () => {
      throw new Error("out");
    });
    await request(app.server).get("/api/x").expect(500);
    await request(app.server).get("/y").expect(500);
    assert.deepEqual(seen, ["in"]);
  });

  test("errors after headers were sent still reach the layers with headersSent true", async () => {
    const app = makeApp();
    let sawSent: boolean | undefined;
    app.use((_err: ZonixError, _req: any, res: any, next: any) => {
      sawSent = res.headersSent;
      next();
    });
    app.handleErr(() => {});
    app.get("/late", (_req, res) => {
      res.write("partial");
      throw new Error("late");
    });
    await request(app.server)
      .get("/late")
      .then(
        () => {},
        () => {},
      );
    assert.equal(sawSent, true);
  });
});

describe("maxParamLength guard", () => {
  test("default 100: exactly 100 passes, 101 is a 414 before any handler runs", async () => {
    const app = makeApp();
    let ran = 0;
    app.get("/u/:id", (req, res) => {
      ran++;
      res.json({ len: req.params["id"]?.length });
    });
    const ok = await request(app.server)
      .get("/u/" + "a".repeat(100))
      .expect(200);
    assert.equal(ok.body.len, 100);
    const r = await request(app.server)
      .get("/u/" + "a".repeat(101))
      .expect(414);
    assert.equal(r.body.error, 'Path parameter ":id" exceeds maxParamLength (100)');
    assert.equal(ran, 1);
  });

  test("counts decoded length; configurable; wildcard tails are exempt; Infinity disables", async () => {
    const app = zonix({ dev: false, maxParamLength: 5 });
    app.get("/u/:id", (req, res) => res.json({ id: req.params["id"] }));
    app.get("/files/*", (req, res) => res.json({ rest: req.params["*"] }));
    await request(app.server).get("/u/abcde").expect(200, { id: "abcde" });
    await request(app.server).get("/u/abcdef").expect(414);
    // "%C3%A9" is 6 encoded bytes but one decoded character: 5 chars pass.
    await request(app.server).get("/u/ab%C3%A9cd").expect(200, { id: "abécd" });
    await request(app.server).get("/u/ab%C3%A9cde").expect(414);
    await request(app.server)
      .get("/files/" + "x".repeat(500))
      .expect(200);

    const open = zonix({ dev: false, maxParamLength: Infinity });
    open.get("/u/:id", (req, res) => res.json({ len: req.params["id"]?.length }));
    const r = await request(open.server)
      .get("/u/" + "a".repeat(5000))
      .expect(200);
    assert.equal(r.body.len, 5000);
  });

  test("applies inside mounted routers with the app's setting; 414 is routed to error middleware", async () => {
    const app = zonix({ dev: false, maxParamLength: 3 });
    const r = Router();
    r.get("/:id", (req, res) => res.json({ id: req.params["id"] }));
    app.use("/api", r);
    const seen: Array<string | undefined> = [];
    app.use((err: ZonixError, _req: any, _res: any, next: any) => {
      seen.push(err.code);
      next(err);
    });
    await request(app.server).get("/api/abc").expect(200);
    await request(app.server).get("/api/abcd").expect(414);
    assert.deepEqual(seen, [ErrorCode.URI_TOO_LONG]);
  });

  test("a static route with an over-long static segment is unaffected", async () => {
    const app = zonix({ dev: false, maxParamLength: 3 });
    const long = "/" + "s".repeat(50);
    app.get(long, (_req, res) => res.json({ ok: true }));
    await request(app.server).get(long).expect(200);
  });
});
