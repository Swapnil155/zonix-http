import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import type { ZonixError } from "../lib/index.js";
import { makeApp, start, trapUnhandledRejections } from "./helpers.js";

/** Big enough that the stream cannot finish before the client hangs up. */
let dir: string;
let bigFile: string;
/** Under the 32KB threshold, so it takes the buffered send path instead. */
let smallFile: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "zonix-disconnect-"));
  bigFile = join(dir, "big.txt");
  writeFileSync(bigFile, Buffer.alloc(24 * 1024 * 1024, "x"));
  smallFile = join(dir, "small.txt");
  writeFileSync(smallFile, Buffer.alloc(1024, "x"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Issue a request, kill the socket as soon as the first byte arrives, then settle. */
function abortAfterFirstChunk(url: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.once("data", () => {
        req.destroy();
        setTimeout(resolve, 250);
      });
    });
    req.on("error", () => setTimeout(resolve, 250));
  });
}

describe("client disconnects", () => {
  test("aborting mid-sendFile leaves the server alive and is tagged, not logged as a fault", async () => {
    const trap = trapUnhandledRejections();
    const app = makeApp();
    const seen: ZonixError[] = [];

    app.get("/big", (_req, res) => res.sendFile(bigFile));
    app.get("/ping", (_req, res) => res.json({ alive: true }));
    app.handleErr((err) => {
      seen.push(err);
    });

    const server = await start(app);
    try {
      await abortAfterFirstChunk(`${server.url}/big`);

      assert.equal(seen.length, 1, "the disconnect should surface exactly once");
      assert.equal(seen[0]?.clientDisconnect, true);
      assert.equal(trap.reasons.length, 0, "no unhandled rejections");

      // The process survived and is still serving.
      await request(app.server).get("/ping").expect(200, { alive: true });
    } finally {
      trap.restore();
      await server.close();
    }
  });

  test("aborting mid-response is tagged as a disconnect", async () => {
    const trap = trapUnhandledRejections();
    const app = makeApp();
    const seen: ZonixError[] = [];

    app.get("/slow", async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.write("first chunk");
      await new Promise((r) => setTimeout(r, 100));
      await new Promise<void>((resolve, reject) => {
        res.write("second chunk", (err) => (err ? reject(err) : resolve()));
      });
      res.end();
    });
    app.get("/ping", (_req, res) => res.json({ alive: true }));
    app.handleErr((err) => {
      seen.push(err);
    });

    const server = await start(app);
    try {
      await abortAfterFirstChunk(`${server.url}/slow`);

      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.clientDisconnect, true);
      assert.equal(trap.reasons.length, 0, "no unhandled rejections");

      await request(app.server).get("/ping").expect(200, { alive: true });
    } finally {
      trap.restore();
      await server.close();
    }
  });

  test("an ignored sendFile promise cannot produce an unhandled rejection on abort", async () => {
    const trap = trapUnhandledRejections();
    const app = makeApp();
    let handled = 0;

    app.get("/big", (_req, res) => {
      // Not awaited: the chain finishes while the stream is still running.
      void res.sendFile(bigFile);
    });
    app.handleErr((err) => {
      if (err.clientDisconnect) handled += 1;
    });

    const server = await start(app);
    try {
      await abortAfterFirstChunk(`${server.url}/big`);
      assert.equal(trap.reasons.length, 0, "no unhandled rejections");
      assert.equal(handled, 1);
    } finally {
      trap.restore();
      await server.close();
    }
  });

  test("with no error handler registered, an abort still does not crash the process", async () => {
    const trap = trapUnhandledRejections();
    const app = makeApp();
    app.get("/big", (_req, res) => res.sendFile(bigFile));
    app.get("/ping", (_req, res) => res.json({ alive: true }));

    const server = await start(app);
    try {
      await abortAfterFirstChunk(`${server.url}/big`);
      assert.equal(trap.reasons.length, 0);
      await request(app.server).get("/ping").expect(200, { alive: true });
    } finally {
      trap.restore();
      await server.close();
    }
  });

  test("a client that vanishes before a buffered small file is written cannot crash the server", async () => {
    const trap = trapUnhandledRejections();
    const app = makeApp();
    const seen: ZonixError[] = [];

    app.get("/small", (_req, res) => res.sendFile(smallFile));
    app.get("/ping", (_req, res) => res.json({ alive: true }));
    app.handleErr((err) => {
      seen.push(err);
    });

    const server = await start(app);
    try {
      // Write the request then kill the socket immediately: the buffered path
      // reaches end() with nowhere to send it.
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve) => {
          const socket = net.connect(server.port, "127.0.0.1", () => {
            socket.write("GET /small HTTP/1.1\r\nHost: t\r\n\r\n");
            socket.destroy();
            resolve();
          });
          socket.on("error", () => resolve());
        });
      }
      await new Promise((r) => setTimeout(r, 300));

      assert.equal(trap.reasons.length, 0, "no unhandled rejections");
      // Anything that did surface must be tagged as the client leaving.
      for (const err of seen) assert.equal(err.clientDisconnect, true, `untagged: ${err.message}`);

      await request(app.server).get("/ping").expect(200, { alive: true });
    } finally {
      trap.restore();
      await server.close();
    }
  });
});
