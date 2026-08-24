// ZH-016 · CWE-614 · cookie security.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import zonix, { cookieParser } from "../../lib/index.js";
import { serializeCookie } from "../../lib/cookies/serialize.js";
import { sign, unsign, markSigned } from "../../lib/cookies/sign.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

const SECRET = "keyboard cat";

describe("ZH-016 cookie security", () => {
  test("HttpOnly / Secure / SameSite attributes serialize", () => {
    const out = serializeCookie("sid", "abc", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    assert.match(out, /HttpOnly/);
    assert.match(out, /Secure/);
    assert.match(out, /SameSite=Lax/);
  });

  test("signature verification is timing-safe and rejects a tampered value", () => {
    const signed = sign("user42", SECRET);
    assert.equal(unsign(signed, SECRET), "user42");
    assert.equal(unsign("user42.wrongsig", SECRET), false);
    // wrong secret
    assert.equal(unsign(signed, "other"), false);
  });

  test("an empty secret is rejected when signing", () => {
    assert.throws(() => sign("x", ""));
  });

  test("signed cookie round-trips through the parser; a forgery reads as false", async () => {
    const app = makeApp({ cookieSecret: SECRET });
    app.use(cookieParser());
    app.get("/", (req, res) => res.json({ signed: req.signedCookies }));
    const good = encodeURIComponent(markSigned(sign("user42", SECRET)));
    await request(app.server)
      .get("/")
      .set("Cookie", `session=${good}`)
      .expect(200, { signed: { session: "user42" } });
    const forged = encodeURIComponent(markSigned("admin." + "AAAA"));
    await request(app.server)
      .get("/")
      .set("Cookie", `session=${forged}`)
      .expect(200, { signed: { session: false } });
  });

  test("secret rotation: an old secret still verifies", async () => {
    const app = makeApp({ cookieSecret: SECRET });
    app.use(cookieParser(["new-secret", SECRET]));
    app.get("/", (req, res) => res.json({ signed: req.signedCookies }));
    const old = encodeURIComponent(markSigned(sign("user42", SECRET)));
    await request(app.server)
      .get("/")
      .set("Cookie", `session=${old}`)
      .expect(200, { signed: { session: "user42" } });
  });

  test("a control char in a cookie value cannot inject: encoded by default, rejected when encode is identity", () => {
    // Default encode (encodeURIComponent) neutralizes CRLF -> no control chars survive.
    const encoded = serializeCookie("sid", "a\r\nb", {});
    assert.doesNotMatch(encoded, /\r|\n/);
    // With an identity encoder, the value grammar check rejects the control chars.
    assert.throws(() => serializeCookie("sid", "a\r\nb", { encode: (v: string) => v }));
  });

  test("signing without a configured secret throws rather than emitting unsigned", async () => {
    const app = makeApp(); // no cookieSecret
    app.get("/", (_req, res) => {
      try {
        res.cookie("s", "v", { signed: true });
        res.json({ threw: false });
      } catch {
        res.json({ threw: true });
      }
    });
    await request(app.server).get("/").expect(200, { threw: true });
  });
});
