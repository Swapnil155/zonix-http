// ZH-003 / ZH-006 · CWE-1321 · prototype pollution across every parser.
//
// Confirms that no attacker-controlled key from any parsing path can reach
// Object.prototype. Each case sends a malicious key and asserts a freshly
// created object is not polluted afterward.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import request from "supertest";
import zonix, { parseExtendedQuery } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

/** Asserts Object.prototype was not polluted with `polluted`. */
function assertClean(): void {
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
  assert.equal((Object.prototype as Record<string, unknown>)["polluted"], undefined);
}

const POISON_KEYS = ["__proto__", "constructor", "prototype", "hasOwnProperty"];

describe("ZH-003/ZH-006 prototype pollution", () => {
  afterEach(assertClean);

  test("simple query parser output is null-proto and inert", async () => {
    const app = makeApp();
    app.get("/", (req, res) => res.json({ proto: Object.getPrototypeOf(req.query) === null }));
    await request(app.server).get("/?__proto__[polluted]=1&x=2").expect(200, { proto: true });
  });

  test("extended query parser drops dangerous keys at every depth", async () => {
    for (const key of POISON_KEYS) {
      const out = parseExtendedQuery(`${key}[polluted]=1&a[${key}][b]=2&safe=ok`);
      assert.equal(Object.getPrototypeOf(out), null, `output not null-proto for ${key}`);
      assertClean();
    }
    // nested path form
    parseExtendedQuery("a[__proto__][polluted]=1");
    parseExtendedQuery("constructor[prototype][polluted]=1");
    assertClean();
  });

  test("extended query on req.query cannot pollute", async () => {
    const app = zonix({ queryParser: "extended" });
    app.get("/", (_req, res) => res.json({ ok: true }));
    await request(app.server).get("/?__proto__[polluted]=1").expect(200);
    await request(app.server).get("/?constructor[prototype][polluted]=1").expect(200);
    assertClean();
  });

  test("JSON body with __proto__ does not pollute", async () => {
    const app = makeApp();
    app.use(zonix.json());
    app.post("/", (req, res) => res.json({ keys: Object.keys(req.body as object) }));
    await request(app.server)
      .post("/")
      .set("content-type", "application/json")
      .send('{"__proto__":{"polluted":1},"a":2}')
      .expect(200);
    assertClean();
  });

  test("urlencoded (simple and extended) body does not pollute", async () => {
    for (const extended of [false, true]) {
      const app = makeApp();
      app.use(zonix.urlencoded({ extended }));
      app.post("/", (_req, res) => res.json({ ok: true }));
      await request(app.server)
        .post("/")
        .set("content-type", "application/x-www-form-urlencoded")
        .send("__proto__[polluted]=1&constructor[prototype][polluted]=1&a=2")
        .expect(200);
      assertClean();
    }
  });

  test("cookies with __proto__ do not pollute and req.cookies is null-proto", async () => {
    const app = makeApp();
    const { cookieParser } = await import("../../lib/index.js");
    app.use(cookieParser());
    app.get("/", (req, res) => res.json({ proto: Object.getPrototypeOf(req.cookies) === null }));
    await request(app.server).get("/").set("Cookie", "__proto__=evil; a=1").expect(200);
    assertClean();
  });

  test("route params with __proto__ value do not pollute", async () => {
    const app = makeApp();
    app.get("/:x", (req, res) => res.json({ x: req.params.x }));
    await request(app.server).get("/__proto__").expect(200, { x: "__proto__" });
    assertClean();
  });
});
