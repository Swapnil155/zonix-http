import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import { ErrorCode, type ZonixError } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
describe("response helpers", () => {
  test("json() sets content-type, content-length and serializes the body", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.json({ hello: "world" }));

    const res = await request(app.server).get("/").expect(200);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(res.headers["content-length"], String(Buffer.byteLength('{"hello":"world"}')));
    assert.deepEqual(res.body, { hello: "world" });
  });

  test("json() counts bytes, not characters, for multi-byte payloads", async () => {
    const app = makeApp();
    const payload = { text: "héllo — ünicode ☃" };
    app.get("/", (_req, res) => res.json(payload));

    const res = await request(app.server).get("/").expect(200);
    assert.equal(
      res.headers["content-length"],
      String(Buffer.byteLength(JSON.stringify(payload), "utf8")),
    );
    assert.deepEqual(res.body, payload);
  });

  test("status() chains and sets the code", async () => {
    const app = makeApp();
    app.post("/", (_req, res) => res.status(201).json({ created: true }));

    await request(app.server).post("/").expect(201, { created: true });
  });

  test("status() rejects out-of-range codes", async () => {
    const app = makeApp();
    app.get("/", (_req, res) => res.status(999).json({}));

    const res = await request(app.server).get("/").expect(500);
    assert.deepEqual(res.body, { error: "Internal Server Error" });
  });

  test("redirect() defaults to 302", async () => {
    const app = makeApp();
    app.get("/old", (_req, res) => res.redirect("/new"));

    const res = await request(app.server).get("/old").expect(302);
    assert.equal(res.headers["location"], "/new");
  });

  test("redirect() honours an explicit code", async () => {
    const app = makeApp();
    app.get("/old", (_req, res) => res.redirect("/new", 301));

    const res = await request(app.server).get("/old").expect(301);
    assert.equal(res.headers["location"], "/new");
  });

  test("a second send after headers are sent does not crash the server", async () => {
    const app = makeApp();
    app.get("/twice", (_req, res) => {
      res.status(200).json({ first: true });
      res.status(200).json({ second: true });
    });

    const res = await request(app.server).get("/twice").expect(200);
    assert.deepEqual(res.body, { first: true });

    // The process is still healthy and serving.
    app.get("/after", (_req, res) => res.json({ alive: true }));
    await request(app.server).get("/after").expect(200, { alive: true });
  });
});

describe("request helpers", () => {
  test("query is parsed lazily and cached", async () => {
    const app = makeApp();
    app.get("/search", (req, res) => {
      const first = req.query;
      const second = req.query;
      res.json({ query: first, cached: first === second });
    });

    await request(app.server)
      .get("/search?q=node&limit=10")
      .expect(200, { query: { q: "node", limit: "10" }, cached: true });
  });

  test("an absent query yields an empty object", async () => {
    const app = makeApp();
    app.get("/none", (req, res) =>
      res.json({ query: req.query, empty: Object.keys(req.query).length }),
    );

    await request(app.server).get("/none").expect(200, { query: {}, empty: 0 });
  });

  test("query decodes percent-encoding and plus signs", async () => {
    const app = makeApp();
    app.get("/search", (req, res) => res.json(req.query));

    await request(app.server)
      .get("/search?q=hello%20world&tag=a%2Bb")
      .expect(200, { q: "hello world", tag: "a+b" });
  });

  test("body is undefined until a parser populates it", async () => {
    const app = makeApp();
    app.get("/", (req, res) => res.json({ hasBody: req.body !== undefined }));

    await request(app.server).get("/").expect(200, { hasBody: false });
  });

  test("path excludes the query string", async () => {
    const app = makeApp();
    app.get("/where", (req, res) => res.json({ path: req.path }));

    await request(app.server).get("/where?a=1").expect(200, { path: "/where" });
  });
});

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
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

  test("a plain ASCII filename gets the simple form, and the type is inferred", async () => {
    const app = makeApp();
    app.get("/dl", (_req, res) => res.attachment("report.pdf").json({ ok: true }));

    const res = await request(app.server).get("/dl").expect(200);
    // Only `filename=`. The earlier implementation also emitted a redundant
    // `filename*=`, which Express does not do for a name that needs no encoding.
    assert.equal(res.headers["content-disposition"], 'attachment; filename="report.pdf"');
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

/**
 * Files at or below 32KB are read into one buffer and sent with a single end();
 * larger files are streamed. Both sides of that threshold must be
 * indistinguishable on the wire apart from the body itself.
 */
describe("res.sendFile: buffered / streamed threshold", () => {
  let dir: string;
  const sizes = {
    empty: 0,
    small: 1024,
    justUnder: 32 * 1024 - 1,
    exact: 32 * 1024,
    justOver: 32 * 1024 + 1,
    large: 256 * 1024,
  };
  const paths: Record<string, string> = {};

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "zonix-threshold-"));
    for (const [name, size] of Object.entries(sizes)) {
      const file = join(dir, `${name}.txt`);
      // Deterministic, non-uniform content so a truncated or shifted body shows up.
      writeFileSync(file, Buffer.from(Array.from({ length: size }, (_, i) => 97 + (i % 26))));
      paths[name] = file;
    }
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  for (const name of Object.keys(sizes)) {
    test(`serves the ${name} file with byte-exact body and length`, async () => {
      const app = makeApp();
      app.get("/f", (_req, res) => res.sendFile(paths[name] as string));

      const expected = readFileSync(paths[name] as string);
      const res = await request(app.server).get("/f").buffer(true).expect(200);

      assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
      assert.equal(res.headers["content-length"], String(expected.byteLength));
      assert.equal(res.headers["transfer-encoding"], undefined, "must not be chunked");

      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text ?? "", "utf8");
      assert.equal(body.byteLength, expected.byteLength);
      assert.ok(body.equals(expected), "body bytes must match the file exactly");
    });
  }

  test("headers are identical either side of the threshold", async () => {
    const app = makeApp();
    app.get("/under", (_req, res) => res.sendFile(paths["justUnder"] as string));
    app.get("/over", (_req, res) => res.sendFile(paths["justOver"] as string));

    const under = await request(app.server).get("/under").buffer(true).expect(200);
    const over = await request(app.server).get("/over").buffer(true).expect(200);

    const shape = (h: Record<string, unknown>) => Object.keys(h).sort().join(",");
    assert.equal(shape(under.headers), shape(over.headers), "same header set on both paths");
    assert.equal(under.headers["content-type"], over.headers["content-type"]);
  });

  test("HEAD on a buffered file sends headers without a body", async () => {
    const app = makeApp();
    // Registered explicitly: HEAD does not fall back to GET routes in v1.
    app.head("/f", (_req, res) => res.sendFile(paths["small"] as string));

    const res = await request(app.server).head("/f").expect(200);
    assert.equal(res.headers["content-length"], String(sizes.small));
    assert.equal(res.text, undefined);
  });
});
