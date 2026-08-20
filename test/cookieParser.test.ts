import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { cookieParser } from "../lib/index.js";
import { makeApp } from "./helpers.js";

function cookieApp() {
  const app = makeApp();
  app.use(cookieParser());
  app.get("/cookies", (req, res) => res.json(req.cookies));
  return app;
}

describe("cookieParser", () => {
  test("parses a single cookie", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "session=abc123")
      .expect(200, { session: "abc123" });
  });

  test("parses multiple cookies", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "session=abc123; theme=dark; lang=en")
      .expect(200, { session: "abc123", theme: "dark", lang: "en" });
  });

  test("keeps '=' inside a value", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "token=a=b=c; other=1")
      .expect(200, { token: "a=b=c", other: "1" });
  });

  test("an absent Cookie header yields an empty object", async () => {
    await request(cookieApp().server).get("/cookies").expect(200, {});
  });

  test("an empty Cookie header yields an empty object", async () => {
    await request(cookieApp().server).get("/cookies").set("Cookie", "").expect(200, {});
  });

  test("percent-encoded values are decoded", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "greeting=hello%20world%21")
      .expect(200, { greeting: "hello world!" });
  });

  test("a malformed encoding is passed through verbatim rather than failing", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "broken=%E0%A4%A")
      .expect(200, { broken: "%E0%A4%A" });
  });

  test("quoted values are unwrapped", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", 'quoted="spaced value"')
      .expect(200, { quoted: "spaced value" });
  });

  test("an empty value is kept", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "empty=; filled=1")
      .expect(200, { empty: "", filled: "1" });
  });

  test("valueless flags are skipped", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "justaflag; real=1")
      .expect(200, { real: "1" });
  });

  test("the first occurrence of a repeated name wins", async () => {
    await request(cookieApp().server)
      .get("/cookies")
      .set("Cookie", "dup=first; dup=second")
      .expect(200, { dup: "first" });
  });

  test("a __proto__ cookie cannot pollute the response object", async () => {
    const app = cookieApp();
    const res = await request(app.server)
      .get("/cookies")
      .set("Cookie", "__proto__=polluted; safe=1")
      .expect(200);

    assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
    assert.equal(res.body.safe, "1");
  });
});
