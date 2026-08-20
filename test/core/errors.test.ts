import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { makeApp } from "../helpers/make-app.js";

describe("error dispatch", () => {
  test("a synchronous throw in a handler reaches handleErr", async () => {
    const app = makeApp();
    let seen: Error | undefined;

    app.get("/boom", () => {
      throw new Error("sync boom");
    });
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(500).json({ error: err.message });
    });

    await request(app.server).get("/boom").expect(500, { error: "sync boom" });
    assert.equal(seen?.message, "sync boom");
  });

  test("a rejected promise in a handler reaches handleErr", async () => {
    const app = makeApp();

    app.get("/boom", async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error("async boom");
    });
    app.handleErr((err, _req, res) => {
      res.status(503).json({ error: err.message });
    });

    await request(app.server).get("/boom").expect(503, { error: "async boom" });
  });

  test("a throw in middleware reaches handleErr", async () => {
    const app = makeApp();

    app.use(() => {
      throw new Error("middleware boom");
    });
    app.get("/", (_req, res) => res.status(200).json({ ok: true }));
    app.handleErr((err, _req, res) => {
      res.status(500).json({ error: err.message });
    });

    await request(app.server).get("/").expect(500, { error: "middleware boom" });
  });

  test("with no handleErr registered, the default 500 leaks no stack or message", async () => {
    const app = makeApp();
    app.get("/boom", () => {
      throw new Error("secret internal detail");
    });

    const res = await request(app.server).get("/boom").expect(500);
    assert.deepEqual(res.body, { error: "Internal Server Error" });
    assert.ok(!res.text.includes("secret internal detail"));
    assert.ok(!res.text.includes("at "));
  });

  test("the error response closes the connection", async () => {
    const app = makeApp();
    app.get("/boom", () => {
      throw new Error("boom");
    });
    app.handleErr((_err, _req, res) => {
      res.status(500).json({ error: "handled" });
    });

    const res = await request(app.server).get("/boom").expect(500);
    assert.equal(res.headers["connection"], "close");
  });

  test("non-Error throws are normalized into Errors", async () => {
    const app = makeApp();
    let seen: unknown;

    app.get("/boom", () => {
      throw "just a string";
    });
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(500).json({ error: err.message });
    });

    await request(app.server).get("/boom").expect(500);
    assert.ok(seen instanceof Error);
    assert.match((seen as Error).message, /just a string/);
  });

  test("when handleErr itself throws, the client still gets a bare 500", async () => {
    const app = makeApp();
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      app.get("/boom", () => {
        throw new Error("original failure");
      });
      app.handleErr(() => {
        throw new Error("handler failure");
      });

      const res = await request(app.server).get("/boom").expect(500);
      assert.deepEqual(res.body, { error: "Internal Server Error" });
    } finally {
      console.error = original;
    }

    // Both the original and the secondary failure are reported to the operator.
    const flat = errors.flat().map(String).join(" ");
    assert.match(flat, /original failure/);
    assert.match(flat, /handler failure/);
  });

  test("an error handler that only observes still produces a response", async () => {
    const app = makeApp();
    let observed = false;

    app.get("/boom", () => {
      throw new Error("observed only");
    });
    app.handleErr(() => {
      observed = true;
    });

    const res = await request(app.server).get("/boom").expect(500);
    assert.equal(observed, true);
    assert.deepEqual(res.body, { error: "Internal Server Error" });
  });

  test("only one error handler may be registered", () => {
    const app = makeApp();
    app.handleErr((_err, _req, res) => res.status(500).end());
    assert.throws(
      () => app.handleErr((_err, _req, res) => res.status(500).end()),
      /already registered/,
    );
  });
});
