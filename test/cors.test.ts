import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { cors, type CorsOptions } from "../lib/index.js";
import { makeApp } from "./helpers.js";

function corsApp(options?: CorsOptions) {
  const app = makeApp();
  app.use(options === undefined ? cors() : cors(options));
  app.get("/data", (_req, res) => res.json({ ok: true }));
  app.post("/data", (_req, res) => res.status(201).json({ created: true }));
  return app;
}

describe("cors: simple requests", () => {
  test("allows any origin by default", async () => {
    const res = await request(corsApp().server)
      .get("/data")
      .set("Origin", "https://example.com")
      .expect(200, { ok: true });
    assert.equal(res.headers["access-control-allow-origin"], "*");
  });

  test("an exact origin match is echoed and marked Vary: Origin", async () => {
    const app = corsApp({ origin: "https://app.example.com" });
    const res = await request(app.server)
      .get("/data")
      .set("Origin", "https://app.example.com")
      .expect(200);
    assert.equal(res.headers["access-control-allow-origin"], "https://app.example.com");
    assert.match(String(res.headers["vary"]), /Origin/);
  });

  test("a disallowed origin gets no allow-origin header", async () => {
    const app = corsApp({ origin: "https://app.example.com" });
    const res = await request(app.server)
      .get("/data")
      .set("Origin", "https://evil.example.com")
      .expect(200);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
    assert.match(String(res.headers["vary"]), /Origin/);
  });

  test("an origin list allows members and refuses the rest", async () => {
    const app = corsApp({ origin: ["https://a.test", "https://b.test"] });

    const allowed = await request(app.server).get("/data").set("Origin", "https://b.test");
    assert.equal(allowed.headers["access-control-allow-origin"], "https://b.test");

    const refused = await request(app.server).get("/data").set("Origin", "https://c.test");
    assert.equal(refused.headers["access-control-allow-origin"], undefined);
  });

  test("a resolver function decides per request", async () => {
    const app = corsApp({
      origin: (origin) => typeof origin === "string" && origin.endsWith(".internal"),
    });

    const allowed = await request(app.server).get("/data").set("Origin", "https://tool.internal");
    assert.equal(allowed.headers["access-control-allow-origin"], "https://tool.internal");

    const refused = await request(app.server).get("/data").set("Origin", "https://tool.public");
    assert.equal(refused.headers["access-control-allow-origin"], undefined);
  });

  test("a resolver may pin a specific origin string", async () => {
    const app = corsApp({ origin: () => "https://pinned.test" });
    const res = await request(app.server).get("/data").set("Origin", "https://whatever.test");
    assert.equal(res.headers["access-control-allow-origin"], "https://pinned.test");
  });

  test("origin: true reflects the caller", async () => {
    const app = corsApp({ origin: true });
    const res = await request(app.server).get("/data").set("Origin", "https://reflected.test");
    assert.equal(res.headers["access-control-allow-origin"], "https://reflected.test");
  });

  test("origin: false refuses everyone", async () => {
    const app = corsApp({ origin: false });
    const res = await request(app.server)
      .get("/data")
      .set("Origin", "https://any.test")
      .expect(200);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });

  test("credentials adds the allow-credentials header", async () => {
    const app = corsApp({ origin: "https://app.test", credentials: true });
    const res = await request(app.server).get("/data").set("Origin", "https://app.test");
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  test("credentials never pairs with a wildcard: the origin is reflected instead", async () => {
    const app = corsApp({ credentials: true });
    const res = await request(app.server).get("/data").set("Origin", "https://app.test");
    assert.equal(res.headers["access-control-allow-origin"], "https://app.test");
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.match(String(res.headers["vary"]), /Origin/);
  });

  test("exposed headers are advertised on the real response", async () => {
    const app = corsApp({ exposedHeaders: ["X-Total-Count", "X-Page"] });
    const res = await request(app.server).get("/data").set("Origin", "https://app.test");
    assert.equal(res.headers["access-control-expose-headers"], "X-Total-Count,X-Page");
  });

  test("a request without an Origin header is untouched and still served", async () => {
    const res = await request(corsApp().server).get("/data").expect(200, { ok: true });
    assert.equal(res.headers["access-control-allow-credentials"], undefined);
  });
});

describe("cors: preflight", () => {
  test("a preflight short-circuits with 204 and never reaches the router", async () => {
    let routeRan = false;
    const app = makeApp();
    app.use(cors());
    app.post("/data", (_req, res) => {
      routeRan = true;
      res.status(201).json({ created: true });
    });

    const res = await request(app.server)
      .options("/data")
      .set("Origin", "https://app.test")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);

    assert.equal(routeRan, false);
    assert.equal(res.headers["access-control-allow-origin"], "*");
    assert.equal(res.headers["access-control-allow-methods"], "GET,HEAD,PUT,PATCH,POST,DELETE");
  });

  test("a preflight for a path with no route still answers 204", async () => {
    const res = await request(corsApp().server)
      .options("/no-such-route")
      .set("Origin", "https://app.test")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    assert.equal(res.headers["access-control-allow-origin"], "*");
  });

  test("requested headers are reflected by default", async () => {
    const res = await request(corsApp().server)
      .options("/data")
      .set("Origin", "https://app.test")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type, x-api-key")
      .expect(204);
    assert.equal(res.headers["access-control-allow-headers"], "content-type, x-api-key");
    assert.match(String(res.headers["vary"]), /Access-Control-Request-Headers/);
  });

  test("configured headers and methods override the defaults", async () => {
    const app = corsApp({
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
      maxAge: 600,
    });
    const res = await request(app.server)
      .options("/data")
      .set("Origin", "https://app.test")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "x-sneaky")
      .expect(204);

    assert.equal(res.headers["access-control-allow-methods"], "GET,POST");
    assert.equal(res.headers["access-control-allow-headers"], "Content-Type");
    assert.equal(res.headers["access-control-max-age"], "600");
  });

  test("a disallowed origin gets a 204 with no allow-origin header", async () => {
    const app = corsApp({ origin: "https://app.test" });
    const res = await request(app.server)
      .options("/data")
      .set("Origin", "https://evil.test")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });

  test("a plain OPTIONS without the preflight header is routed normally", async () => {
    const app = makeApp();
    app.use(cors());
    app.options("/data", (_req, res) => res.status(200).json({ routed: true }));

    await request(app.server).options("/data").set("Origin", "https://app.test").expect(200, {
      routed: true,
    });
  });

  test("optionsSuccessStatus is configurable for legacy clients", async () => {
    const app = corsApp({ optionsSuccessStatus: 200 });
    await request(app.server)
      .options("/data")
      .set("Origin", "https://app.test")
      .set("Access-Control-Request-Method", "GET")
      .expect(200);
  });
});
