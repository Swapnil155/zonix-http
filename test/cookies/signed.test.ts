import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { cookieParser } from "../../lib/index.js";
import { sign, markSigned } from "../../lib/cookies/sign.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

const SECRET = "keyboard cat";

/** `name=s:value.signature` as `res.cookie(..., { signed: true })` writes it. */
function signedPair(name: string, value: string, secret = SECRET): string {
  return `${name}=${encodeURIComponent(markSigned(sign(value, secret)))}`;
}

function echoApp(secret?: string | readonly string[]) {
  const app = makeApp({ dev: false, cookieSecret: SECRET });
  app.use(cookieParser(secret));
  app.get("/both", (req, res) => res.json({ cookies: req.cookies, signed: req.signedCookies }));
  return app;
}

describe("req.signedCookies", () => {
  test("a valid signature moves the value to signedCookies and out of cookies", async () => {
    await request(echoApp().server)
      .get("/both")
      .set("Cookie", `${signedPair("session", "user42")}; theme=dark`)
      .expect(200, { cookies: { theme: "dark" }, signed: { session: "user42" } });
  });

  test("a tampered signature becomes false, never the attacker's value", async () => {
    const forged = signedPair("session", "admin", "wrong-secret");
    await request(echoApp().server)
      .get("/both")
      .set("Cookie", forged)
      .expect(200, { cookies: {}, signed: { session: false } });
  });

  test("a tampered value with a stale signature becomes false", async () => {
    const good = sign("user42", SECRET);
    const swapped = `session=${encodeURIComponent("s:admin." + good.split(".")[1])}`;
    await request(echoApp().server)
      .get("/both")
      .set("Cookie", swapped)
      .expect(200, { cookies: {}, signed: { session: false } });
  });

  test("without any secret, s: values stay raw in cookies and signedCookies is empty", async () => {
    const app = makeApp({ dev: false }); // no cookieSecret
    app.use(cookieParser());
    app.get("/both", (req, res) => res.json({ cookies: req.cookies, signed: req.signedCookies }));
    const wire = markSigned(sign("user42", SECRET));
    await request(app.server)
      .get("/both")
      .set("Cookie", `session=${encodeURIComponent(wire)}`)
      .expect(200, { cookies: { session: wire }, signed: {} });
  });

  test("the explicit argument overrides the app secret", async () => {
    await request(echoApp("other-secret").server)
      .get("/both")
      .set("Cookie", signedPair("session", "user42", "other-secret"))
      .expect(200, { cookies: {}, signed: { session: "user42" } });
  });

  test("an array of secrets supports rotation: any of them verifies", async () => {
    const app = echoApp(["new-secret", SECRET]);
    await request(app.server)
      .get("/both")
      .set("Cookie", signedPair("session", "user42", SECRET))
      .expect(200, { cookies: {}, signed: { session: "user42" } });
    await request(app.server)
      .get("/both")
      .set("Cookie", signedPair("session", "user42", "new-secret"))
      .expect(200, { cookies: {}, signed: { session: "user42" } });
  });

  test("j: JSON cookies revive in both maps; broken JSON stays a string", async () => {
    await request(echoApp().server)
      .get("/both")
      .set(
        "Cookie",
        [
          `prefs=${encodeURIComponent('j:{"a":1}')}`,
          signedPair("cart", 'j:["x","y"]'),
          `broken=${encodeURIComponent("j:{nope")}`,
        ].join("; "),
      )
      .expect(200, {
        cookies: { prefs: { a: 1 }, broken: "j:{nope" },
        signed: { cart: ["x", "y"] },
      });
  });

  test("round trip: res.cookie({ signed: true }) with an object comes back verified and revived", async () => {
    const app = makeApp({ dev: false, cookieSecret: SECRET });
    app.use(cookieParser());
    app.get("/set", (_req, res) =>
      res.cookie("user", { id: 42, name: "ada" }, { signed: true, httpOnly: true }).json({}),
    );
    app.get("/read", (req, res) => res.json(req.signedCookies));

    const setRes = await request(app.server).get("/set").expect(200);
    const cookie = (setRes.headers["set-cookie"] as unknown as string[])[0];
    assert.match(cookie as string, /HttpOnly/);
    await request(app.server)
      .get("/read")
      .set("Cookie", (cookie as string).split(";")[0] as string)
      .expect(200, { user: { id: 42, name: "ada" } });
  });

  test("a __proto__ signed cookie is inert data on a null-prototype map", async () => {
    const app = makeApp({ dev: false, cookieSecret: SECRET });
    app.use(cookieParser());
    app.get("/check", (req, res) => {
      const polluted = ({} as Record<string, unknown>)["hacked"] !== undefined;
      res.json({ polluted, own: Object.keys(req.signedCookies) });
    });
    await request(app.server)
      .get("/check")
      .set("Cookie", signedPair("__proto__", 'j:{"hacked":true}'))
      .expect(200, { polluted: false, own: ["__proto__"] });
  });

  test("no cookie header leaves both maps as the shared empty object", async () => {
    await request(echoApp().server).get("/both").expect(200, { cookies: {}, signed: {} });
  });
});
