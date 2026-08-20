import assert from "node:assert/strict";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import request from "supertest";
import { ErrorCode, serveStatic, type ZonixError } from "../../lib/index.js";
import { makeApp, start } from "../helpers/make-app.js";

const siteRoot = fileURLToPath(new URL("../fixtures/site", import.meta.url));
const fixturesRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

/** Send a raw request line so the client cannot normalize `..` away for us. */
function rawGet(url: string, target: string): Promise<string> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (data += chunk));
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

describe("serveStatic", () => {
  test("serves a file with the right MIME type", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));

    const res = await request(app.server).get("/style.css").expect(200);
    assert.equal(res.headers["content-type"], "text/css; charset=utf-8");
    assert.match(res.text, /color:red/);
  });

  test("serves index.html for a directory", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));

    const res = await request(app.server).get("/").expect(200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.match(res.text, /Index/);
  });

  test("serves nested files", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));

    await request(app.server).get("/nested/deep.txt").expect(200, "nested file\n");
  });

  test("a miss falls through to a later route rather than 404ing", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));
    app.get("/api/status", (_req, res) => res.json({ from: "route" }));

    await request(app.server).get("/api/status").expect(200, { from: "route" });
  });

  test("a miss with no matching route is the normal 404", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));

    const res = await request(app.server).get("/nothing-here.txt").expect(404);
    assert.deepEqual(res.body, { error: "Cannot GET /nothing-here.txt" });
  });

  test("traversal above the root is a 403", async () => {
    const app = makeApp();
    let seen: ZonixError | undefined;
    app.use(serveStatic(siteRoot));
    app.handleErr((err, _req, res) => {
      seen = err;
      res.status(err.status ?? 500).json({ error: "forbidden" });
    });

    const server = await start(app);
    try {
      const raw = await rawGet(server.url, "/../../etc/passwd");
      assert.match(raw, /^HTTP\/1\.1 403/);
      assert.equal(seen?.code, ErrorCode.FORBIDDEN_PATH);
    } finally {
      await server.close();
    }
  });

  test("encoded traversal is a 403 too", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));
    app.handleErr((err, _req, res) => res.status(err.status ?? 500).json({ error: err.code }));

    const server = await start(app);
    try {
      const raw = await rawGet(server.url, "/%2e%2e%2fsecret.txt");
      assert.match(raw, /^HTTP\/1\.1 403/);
      assert.ok(!raw.includes("SECRET"));
    } finally {
      await server.close();
    }
  });

  test("traversal cannot reach a sibling file outside the root", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));
    app.handleErr((_err, _req, res) => res.status(403).json({ error: "forbidden" }));

    const server = await start(app);
    try {
      const raw = await rawGet(server.url, "/../secret.txt");
      assert.ok(!raw.includes("SECRET"), "must not serve a file above the root");
    } finally {
      await server.close();
    }
  });

  test("dotfiles fall through by default, so .env is never served", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));

    const res = await request(app.server).get("/.env").expect(404);
    assert.ok(!JSON.stringify(res.body).includes("should-not-be-served"));
  });

  test("dotfiles: allow serves them", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot, { dotfiles: "allow" }));

    // Served as octet-stream, which superagent hands back as a Buffer, not text.
    const res = await request(app.server).get("/.env").buffer(true).expect(200);
    assert.match(Buffer.from(res.body).toString("utf8"), /should-not-be-served/);
  });

  test("a directory with index: false falls through", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot, { index: false }));

    await request(app.server).get("/").expect(404);
  });

  test("an unknown extension is served as octet-stream instead of failing", async () => {
    const app = makeApp();
    app.use(serveStatic(fixturesRoot));

    const res = await request(app.server).get("/blob.xyz").expect(200);
    assert.equal(res.headers["content-type"], "application/octet-stream");
  });

  test("non-GET methods pass through", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));
    app.post("/style.css", (_req, res) => res.json({ from: "route" }));

    await request(app.server).post("/style.css").expect(200, { from: "route" });
  });

  test("HEAD serves the headers without a body", async () => {
    const app = makeApp();
    app.use(serveStatic(siteRoot));

    const res = await request(app.server).head("/style.css").expect(200);
    assert.equal(res.headers["content-type"], "text/css; charset=utf-8");
    assert.equal(res.text, undefined);
  });

  test("a root is required", () => {
    assert.throws(() => serveStatic(""), /requires a root directory/);
  });
});
