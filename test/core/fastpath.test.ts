// Performance rule 3: a fast path is guarded, not trusted.
//
// Every route here is served twice - once through the no-middleware fast path,
// once through the full chain (forced by registering a no-op global middleware)
// - and the raw bytes on the wire must be identical. This is the guard against
// the classic fast-path drift bug, where an optimization quietly changes a
// header, a status, or an error route.
import assert from "node:assert/strict";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import zonix, { type Zonix } from "../../lib/index.js";
import { start } from "../helpers/make-app.js";

const fixture = fileURLToPath(new URL("../fixtures/hello.txt", import.meta.url));

/** Register the identical route table on an app. */
function defineRoutes(app: Zonix): void {
  app.get("/json", (_req, res) => res.status(200).json({ hello: "world" }));
  app.get("/users/:id", (req, res) => res.json({ id: req.params["id"], q: req.query }));
  app.get("/files/*", (req, res) => res.json({ tail: req.params["*"] }));
  app.get("/redirect", (_req, res) => res.redirect("/elsewhere", 301));
  app.get("/attachment", (_req, res) => res.attachment("report.pdf").json({ ok: true }));
  app.get("/file", (_req, res) => res.sendFile(fixture));
  app.get("/throw", () => {
    throw new Error("boom");
  });
  app.get("/reject", async () => {
    await new Promise((r) => setTimeout(r, 1));
    throw new Error("async boom");
  });
  app.get("/next-err", (_req, _res, next) => next(new Error("via next")));
  app.get("/empty", (_req, res) => res.status(204).end());
}

/** Raw HTTP/1.1 request; returns the complete response bytes as a string. */
function rawRequest(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: bench.test\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (data += chunk));
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

/** Date changes between requests by design; nothing else may. */
const normalize = (raw: string): string => raw.replace(/^Date: .*$/gm, "Date: <normalized>");

const TARGETS = [
  "/json",
  "/users/42",
  "/users/a%20b?verbose=1",
  "/files/img/logo.png",
  "/redirect",
  "/attachment",
  "/file",
  "/throw",
  "/reject",
  "/next-err",
  "/empty",
  "/no-such-route",
];

describe("fast path equivalence", () => {
  test("fast path and full chain produce byte-identical responses", async () => {
    // No global middleware: matched routes with no route middleware take the
    // single-handler fast path in #handle.
    const fast = zonix({ dev: false });
    defineRoutes(fast);

    // One no-op global is enough to force every request through the chain.
    const slow = zonix({ dev: false });
    slow.use((_req, _res, next) => next());
    defineRoutes(slow);

    const fastServer = await start(fast);
    const slowServer = await start(slow);

    try {
      for (const target of TARGETS) {
        const viaFast = normalize(await rawRequest(fastServer.port, target));
        const viaSlow = normalize(await rawRequest(slowServer.port, target));
        assert.equal(viaFast, viaSlow, `fast/slow path differ for ${target}`);
      }
    } finally {
      await fastServer.close();
      await slowServer.close();
    }
  });

  test("errors reach the same handler by either path, with the same tagging", async () => {
    const seen: Record<string, string[]> = { fast: [], slow: [] };

    const fast = zonix({ dev: false });
    defineRoutes(fast);
    fast.handleErr((err, _req, res) => {
      seen["fast"]?.push(`${err.message}|${err.code ?? ""}|${err.clientDisconnect ?? false}`);
      if (!res.headersSent) res.status(500).json({ error: "handled" });
    });

    const slow = zonix({ dev: false });
    slow.use((_req, _res, next) => next());
    defineRoutes(slow);
    slow.handleErr((err, _req, res) => {
      seen["slow"]?.push(`${err.message}|${err.code ?? ""}|${err.clientDisconnect ?? false}`);
      if (!res.headersSent) res.status(500).json({ error: "handled" });
    });

    const fastServer = await start(fast);
    const slowServer = await start(slow);

    try {
      for (const target of ["/throw", "/reject", "/next-err"]) {
        const viaFast = normalize(await rawRequest(fastServer.port, target));
        const viaSlow = normalize(await rawRequest(slowServer.port, target));
        assert.equal(viaFast, viaSlow, `error response differs for ${target}`);
      }
    } finally {
      await fastServer.close();
      await slowServer.close();
    }

    // Both paths must funnel through the one dispatcher, seeing the same errors.
    assert.deepEqual(seen["fast"], seen["slow"]);
    assert.equal(seen["fast"]?.length, 3);
  });

  test("a route with its own middleware never takes the fast path but matches it", async () => {
    const bare = zonix({ dev: false });
    bare.get("/x", (_req, res) => res.json({ ok: true }));

    const withRouteMw = zonix({ dev: false });
    withRouteMw.get(
      "/x",
      (_req, _res, next) => next(),
      (_req, res) => res.json({ ok: true }),
    );

    const a = await start(bare);
    const b = await start(withRouteMw);
    try {
      assert.equal(
        normalize(await rawRequest(a.port, "/x")),
        normalize(await rawRequest(b.port, "/x")),
      );
    } finally {
      await a.close();
      await b.close();
    }
  });
});
