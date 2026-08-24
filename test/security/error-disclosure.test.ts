// ZH-017 · error information disclosure.
//
// A 5xx never leaks a stack trace, file path, or the underlying error message.
// 4xx client errors surface their (framework-authored) message by design.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

describe("ZH-017 error disclosure", () => {
  test("a thrown error yields a generic 500 with no stack or message leak", async () => {
    const app = makeApp();
    app.get("/", () => {
      throw new Error("secret detail: /etc/passwd and a stack trace");
    });
    const res = await request(app.server).get("/").expect(500);
    assert.equal(res.body.error, "Internal Server Error");
    const text = JSON.stringify(res.body) + (res.text ?? "");
    assert.doesNotMatch(text, /secret detail/, "error message leaked");
    assert.doesNotMatch(text, /etc\/passwd/, "path leaked");
    assert.doesNotMatch(text, /at .*\(.*:\d+:\d+\)/, "stack frame leaked");
  });

  test("an async rejection also yields a generic 500", async () => {
    const app = makeApp();
    app.get("/", async () => {
      await Promise.resolve();
      throw new Error("internal boom with /home/app/secret.key");
    });
    const res = await request(app.server).get("/").expect(500);
    assert.equal(res.body.error, "Internal Server Error");
    assert.doesNotMatch(JSON.stringify(res.body), /secret\.key/);
  });

  test("a 4xx client error surfaces its framework message (no stack)", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.status(400).json({ error: "bad request shape" }));
    const res = await request(app.server).get("/").expect(400);
    assert.equal(res.body.error, "bad request shape");
  });
});
