// ZH-007 · CWE-93/CWE-113 · header injection / CRLF & response splitting.
//
// Node's setHeader is a hard backstop, but the framework's own choke-point
// (assertHeaderValue) now rejects CR/LF/NUL AND every other control character,
// in both header NAMES and VALUES, across all APIs that route through res.set.
// location/redirect neutralize CRLF by percent-encoding; cookies are validated
// by the serializer and again through res.set.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { ErrorCode, type ZonixError } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

const VECTORS: [string, string][] = [
  ["CRLF", "good\r\nX-Evil: injected"],
  ["bare LF", "good\nX-Evil: injected"],
  ["bare CR", "good\rX-Evil: injected"],
  ["NUL", "good\0evil"],
  ["vertical tab", "good\x0bevil"],
  ["form feed", "good\x0cevil"],
  ["DEL", "good\x7fevil"],
];

describe("ZH-007 header injection / CRLF", () => {
  test("res.set rejects control chars in the value (every vector)", () => {
    for (const [name, payload] of VECTORS) {
      assert.throws(
        () => res_set_throws(payload),
        (err: unknown) => (err as ZonixError).code === ErrorCode.INVALID_ARGUMENT,
        name,
      );
    }
  });

  test("res.set rejects a header NAME containing control characters", () => {
    assert.throws(
      () => res_setName_throws("X-Bad\r\nInjected", "v"),
      (err: unknown) => (err as ZonixError).code === ErrorCode.INVALID_ARGUMENT,
    );
    assert.throws(
      () => res_setName_throws("X Bad", "v"), // space is not a token char
      (err: unknown) => (err as ZonixError).code === ErrorCode.INVALID_ARGUMENT,
    );
  });

  test("a legitimate value with a tab and high bytes is still accepted", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.set("X-Note", "a\tbé").json({ ok: true }));
    const res = await request(app.server).get("/").expect(200);
    assert.equal(res.headers["x-note"], "a\tbé");
  });

  test("no injected header appears on the wire when a bad value is used", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => {
      try {
        res.set("X-Test", "good\r\nX-Evil: injected");
      } catch {
        /* rejected as expected */
      }
      res.json({ ok: true });
    });
    const res = await request(app.server).get("/").expect(200);
    assert.equal(res.headers["x-evil"], undefined, "an injected header reached the client");
  });

  test("res.append is not a bypass — it routes through the validated set", () => {
    assert.throws(
      () => res_append_throws("good\r\nX-Evil: 1"),
      (err: unknown) => (err as ZonixError).code === ErrorCode.INVALID_ARGUMENT,
    );
  });

  test("res.location percent-encodes CRLF instead of splitting", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.location("/next\r\nX-Evil: injected").json({ ok: true }));
    const res = await request(app.server).get("/").expect(200);
    assert.equal(res.headers["x-evil"], undefined);
    assert.match(res.headers.location as string, /%0[dD]|%0[aA]/, "CRLF was not encoded");
  });

  test("res.cookie CRLF in the value cannot inject a header (encoded, not split)", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.cookie("sid", "abc\r\nX-Evil: 1").json({ ok: true }));
    const res = await request(app.server).get("/").expect(200);
    const setCookie = (res.headers["set-cookie"] as unknown as string[])[0] ?? "";
    assert.doesNotMatch(setCookie, /\r|\n/, "raw CRLF survived into Set-Cookie");
    assert.equal(res.headers["x-evil"], undefined, "cookie value injected a header");
  });
});

// --- helpers that construct a real response and invoke the API synchronously ---
import { ZonixResponse } from "../../lib/response.js";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

function freshRes(): ZonixResponse {
  const req = new IncomingMessage(new Socket());
  return new ZonixResponse(req as never);
}
function res_set_throws(value: string): void {
  freshRes().set("X-Test", value);
}
function res_setName_throws(name: string, value: string): void {
  freshRes().set(name, value);
}
function res_append_throws(value: string): void {
  freshRes().append("X-Test", value);
}
function res_cookie_throws(name: string, value: string): void {
  freshRes().cookie(name, value);
}
