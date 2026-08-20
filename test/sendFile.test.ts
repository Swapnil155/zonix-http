import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import request from "supertest";
import { ErrorCode, type ZonixError } from "../lib/index.js";
import { makeApp } from "./helpers.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name: string): string => fixtures + name;

describe("res.sendFile", () => {
  test("streams a file with inferred MIME and byte-exact Content-Length", async () => {
    const app = makeApp();
    app.get("/hello", (_req, res) => res.sendFile(fixture("hello.txt")));

    const expected = readFileSync(fixture("hello.txt"));
    const res = await request(app.server).get("/hello").expect(200);
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(res.headers["content-length"], String(expected.byteLength));
    assert.equal(res.text, expected.toString("utf8"));
  });

  test("infers text/html for .html", async () => {
    const app = makeApp();
    app.get("/page", (_req, res) => res.sendFile(fixture("page.html")));

    const res = await request(app.server).get("/page").expect(200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  });

  test("an explicit MIME argument wins over the extension", async () => {
    const app = makeApp();
    app.get("/raw", (_req, res) => res.sendFile(fixture("page.html"), "text/plain"));

    const res = await request(app.server).get("/raw").expect(200);
    assert.equal(res.headers["content-type"], "text/plain");
  });

  test("an unknown extension without an explicit type is an actionable error", async () => {
    const app = makeApp();
    let seen: ZonixError | undefined;

    app.get("/blob", (_req, res) => res.sendFile(fixture("blob.xyz")));
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(500).json({ error: "handled" });
    });

    await request(app.server).get("/blob").expect(500);
    assert.equal(seen?.code, ErrorCode.UNKNOWN_MIME);
    assert.match(String(seen?.message), /Pass an explicit type/);
  });

  test("an unknown extension is fine with an explicit type", async () => {
    const app = makeApp();
    app.get("/blob", (_req, res) => res.sendFile(fixture("blob.xyz"), "application/octet-stream"));

    const res = await request(app.server).get("/blob").expect(200);
    assert.equal(res.headers["content-type"], "application/octet-stream");
  });

  test("a missing file reaches handleErr with FILE_NOT_FOUND", async () => {
    const app = makeApp();
    let seen: ZonixError | undefined;

    app.get("/gone", (_req, res) => res.sendFile(fixture("does-not-exist.txt")));
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(err.status ?? 500).json({ error: "missing" });
    });

    await request(app.server).get("/gone").expect(404, { error: "missing" });
    assert.equal(seen?.code, ErrorCode.FILE_NOT_FOUND);
    assert.equal(seen?.status, 404);
  });

  test("a missing file with no handleErr uses the default 404", async () => {
    const app = makeApp();
    app.get("/gone", (_req, res) => res.sendFile(fixture("does-not-exist.txt")));

    const res = await request(app.server).get("/gone").expect(404);
    assert.match(String(res.body.error), /File not found/);
  });

  test("a directory is rejected, not streamed", async () => {
    const app = makeApp();
    let seen: ZonixError | undefined;

    app.get("/dir", (_req, res) => res.sendFile(fixture("site")));
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(500).json({ error: "handled" });
    });

    await request(app.server).get("/dir").expect(500);
    assert.equal(seen?.code, ErrorCode.NOT_A_FILE);
  });

  test("an ignored sendFile promise still routes failures to handleErr", async () => {
    const app = makeApp();
    let seen: ZonixError | undefined;

    app.get("/gone", (_req, res) => {
      // Deliberately not awaited or returned.
      void res.sendFile(fixture("does-not-exist.txt"));
    });
    app.handleErr((err, _req, res) => {
      seen = err;
      if (!res.headersSent) res.status(err.status ?? 500).json({ error: "missing" });
    });

    await request(app.server).get("/gone").expect(404);
    assert.equal(seen?.code, ErrorCode.FILE_NOT_FOUND);
  });

  test("an awaited failure is dispatched exactly once", async () => {
    const app = makeApp();
    const seen: ZonixError[] = [];

    app.get("/gone", (_req, res) => res.sendFile(fixture("does-not-exist.txt")));
    app.handleErr((err, _req, res) => {
      seen.push(err);
      res.status(404).json({ error: "missing" });
    });

    await request(app.server).get("/gone").expect(404);
    // Give the deferred safety-net a chance to fire a duplicate.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen.length, 1);
  });

  test("sendFile after the headers are sent is an error, not a crash", async () => {
    const app = makeApp();
    let seen: ZonixError | undefined;

    app.get("/twice", async (_req, res) => {
      res.json({ first: true });
      await res.sendFile(fixture("hello.txt"));
    });
    app.handleErr((err) => {
      seen = err;
    });

    await request(app.server).get("/twice").expect(200, { first: true });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen?.code, ErrorCode.HEADERS_SENT);
  });
});

describe("res.attachment", () => {
  test("sets a bare Content-Disposition with no filename", async () => {
    const app = makeApp();
    app.get("/dl", (_req, res) => res.attachment().json({ ok: true }));

    const res = await request(app.server).get("/dl").expect(200);
    assert.equal(res.headers["content-disposition"], "attachment");
  });

  test("sets both filename forms and infers the type", async () => {
    const app = makeApp();
    app.get("/dl", (_req, res) => res.attachment("report.pdf").json({ ok: true }));

    const res = await request(app.server).get("/dl").expect(200);
    assert.equal(
      res.headers["content-disposition"],
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    assert.equal(res.headers["content-type"], "application/pdf");
  });

  test("encodes non-ASCII filenames and cannot inject a header", async () => {
    const app = makeApp();
    app.get("/dl", (_req, res) => res.attachment('rappört".txt\r\nX-Injected: 1').json({}));

    const res = await request(app.server).get("/dl").expect(200);
    const disposition = String(res.headers["content-disposition"]);
    assert.ok(!disposition.includes("\r"));
    assert.equal(res.headers["x-injected"], undefined);
    assert.match(disposition, /filename\*=UTF-8''/);
  });

  test("combines with sendFile for a download", async () => {
    const app = makeApp();
    app.get("/dl", (_req, res) => {
      res.attachment("greeting.txt");
      return res.sendFile(fixture("hello.txt"));
    });

    const res = await request(app.server).get("/dl").expect(200);
    assert.match(String(res.headers["content-disposition"]), /greeting\.txt/);
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
  });
});
