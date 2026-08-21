/**
 * The Phase 6 exit test, in its strongest form: the same Express-documentation
 * handlers run on **real Express** and on zonix, and the two responses are
 * compared on the wire.
 *
 * Rule 8 exists because "my own tests encode my own misunderstanding". That is
 * not hypothetical here — the first draft of the sibling suite asserted that
 * `res.set("Content-Type", "text/plain")` yields a bare `text/plain`, because
 * that is what the doc snippet looks like. Express actually appends
 * `; charset=utf-8`, and so does zonix. Without an oracle the "fix" would have
 * been to break a correct implementation to match a wrong assertion — exactly
 * the Content-Disposition failure again.
 *
 * Express is pinned as a devDependency (it is already there for the bench).
 * Nothing in `lib/` depends on it.
 *
 * Known, deliberate deviations are asserted explicitly at the bottom rather
 * than excluded silently — a compat table you cannot see is not a compat table.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import zonix, { parseJSON, type Zonix } from "../../lib/index.js";
import { start, type RunningApp } from "../helpers/make-app.js";
import { DOCS_REQUESTS, registerDocsRoutes, type DocsRequest } from "./docs-routes.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const express = require("express") as any;

const SECRET = "docs-secret";

/**
 * Headers compared byte-for-byte.
 *
 * Everything outside this list is either transport noise (`Date`,
 * `Connection`, `Keep-Alive`, `Transfer-Encoding`) or a documented deviation
 * (`X-Powered-By`, which zonix does not advertise; `ETag`, which zonix defaults
 * off per performance rule 4). Those are asserted separately below.
 */
const COMPARED = ["content-type", "content-length", "location", "link", "vary", "warning"] as const;

/**
 * Routes where only the headers and status are compared, not the body.
 *
 * `res.redirect` is the sole entry: Express writes a courtesy body ("Found.
 * Redirecting to /foo/bar") chosen by `res.format`, which needs the Phase 7
 * negotiator. Deferring `res.format` to Phase 7 is approved in CLAUDE.md, so
 * the body is deferred with it rather than approximated — the difference is
 * asserted explicitly below instead of being hidden here.
 */
const HEADERS_ONLY = new Set(["/redirect/"]);
const headersOnly = (path: string): boolean =>
  [...HEADERS_ONLY].some((prefix) => path.startsWith(prefix));

/** Normalize the parts of a Set-Cookie that legitimately vary per run. */
function normalizeCookies(values: string[]): string[] {
  return values
    .map((v) => v.replace(/Expires=[^;]+/i, "Expires=<date>"))
    .slice()
    .sort();
}

interface Captured {
  status: number;
  headers: Record<string, string | null>;
  cookies: string[];
  body: string;
  etag: string | null;
  poweredBy: string | null;
}

async function capture(base: string, request: DocsRequest): Promise<Captured> {
  const res = await fetch(`${base}${request.path}`, {
    method: request.method,
    headers: request.headers ?? {},
    body: request.body,
    redirect: "manual",
  });
  const headers: Record<string, string | null> = {};
  for (const field of COMPARED) headers[field] = res.headers.get(field);
  return {
    status: res.status,
    headers,
    cookies: normalizeCookies(res.headers.getSetCookie()),
    body: await res.text(),
    etag: res.headers.get("etag"),
    poweredBy: res.headers.get("x-powered-by"),
  };
}

let zonixApp: RunningApp;
let expressUrl: string;
let expressServer: { close: (cb: () => void) => void };

before(async () => {
  const app: Zonix = zonix({ dev: false, cookieSecret: SECRET });
  registerDocsRoutes(app as any, parseJSON());
  zonixApp = await start(app);

  const ex = express();
  ex.disable("etag"); // zonix defaults ETag off (performance rule 4); match it
  // Express reads the signing secret from req.secret, normally set by
  // cookie-parser. Setting it directly keeps the oracle to one package.
  ex.use((req: any, _res: any, next: any) => {
    req.secret = SECRET;
    next();
  });
  registerDocsRoutes(ex, express.json());
  expressServer = await new Promise((resolve) => {
    const server = ex.listen(0, () => resolve(server));
  });
  const address = (expressServer as any).address() as AddressInfo;
  expressUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await zonixApp.close();
  await new Promise<void>((resolve) => expressServer.close(() => resolve()));
});

describe("Phase 6 exit: differential against real Express", () => {
  for (const request of DOCS_REQUESTS) {
    test(`${request.name} — identical on the wire`, async () => {
      const [mine, theirs] = await Promise.all([
        capture(zonixApp.url, request),
        capture(expressUrl, request),
      ]);

      assert.equal(mine.status, theirs.status, "status");
      const skipBody = headersOnly(request.path);
      if (!skipBody) assert.equal(mine.body, theirs.body, "body");
      for (const field of COMPARED) {
        // Content-Length tracks the body, so it is skipped wherever the body is.
        if (skipBody && field === "content-length") continue;
        if (skipBody && field === "content-type") continue;
        // Express's redirect runs through res.format, which also sets
        // `Vary: Accept`. Same Phase 7 deferral, asserted explicitly below.
        if (skipBody && field === "vary") continue;
        assert.equal(mine.headers[field], theirs.headers[field], field);
      }
      assert.deepEqual(mine.cookies, theirs.cookies, "set-cookie");
    });
  }

  test("zonix does not advertise itself; Express sends X-Powered-By", async () => {
    const mine = await capture(zonixApp.url, DOCS_REQUESTS[0] as DocsRequest);
    const theirs = await capture(expressUrl, DOCS_REQUESTS[0] as DocsRequest);
    assert.equal(mine.poweredBy, null);
    assert.equal(theirs.poweredBy, "Express");
  });
});

describe("Phase 6 exit: the deliberate deviations, asserted not assumed", () => {
  test("ETag defaults off (performance rule 4), where Express defaults on", async () => {
    // The differential above disables Express's ETag so the bodies compare;
    // this is the difference a user would actually see out of the box.
    const withEtag = express();
    withEtag.get("/", (_req: any, res: any) => res.send("Hello World!"));
    const server: any = await new Promise((resolve) => {
      const s = withEtag.listen(0, () => resolve(s));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const theirs = await fetch(`http://127.0.0.1:${port}/`);
      assert.ok(theirs.headers.get("etag"), "Express sets an ETag by default");

      const mine = await fetch(`${zonixApp.url}/`);
      assert.equal(mine.headers.get("etag"), null, "zonix does not");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("redirect sends no courtesy body, where Express sends one [P7]", async () => {
    // Express's redirect body is chosen by res.format (text vs html vs none by
    // Accept), which needs the Phase 7 negotiator. Until then zonix sends
    // Content-Length: 0. The status and Location — the parts a client acts on —
    // are identical, which the differential above proves.
    const mine = await fetch(`${zonixApp.url}/redirect/path`, { redirect: "manual" });
    assert.equal(mine.status, 302);
    assert.equal(mine.headers.get("location"), "/foo/bar");
    assert.equal(await mine.text(), "");
    assert.equal(mine.headers.get("content-length"), "0");

    const theirs = await fetch(`${expressUrl}/redirect/path`, { redirect: "manual" });
    assert.equal(theirs.status, 302);
    assert.equal(theirs.headers.get("location"), "/foo/bar");
    assert.equal(await theirs.text(), "Found. Redirecting to /foo/bar");
    assert.equal(theirs.headers.get("vary"), "Accept", "res.format sets Vary: Accept");
    assert.equal((await fetch(`${zonixApp.url}/redirect/path`)).headers.get("vary"), null);
  });

  test("res.type() on an unknown extension falls back, matching Express", async () => {
    // Not a deviation — a bug the oracle caught. zonix used to throw here, on
    // the reasoning that refusing beats a wrong header. Locked decision 11 says
    // unknown types resolve to application/octet-stream and names res.type as a
    // consumer, and real Express agrees. Both authorities outranked the opinion.
    const app = zonix({ dev: false });
    app.get("/", (_req, res) => {
      res.type("not-a-real-extension");
      res.end();
    });
    const running = await start(app);

    const ex = express();
    const server: any = await new Promise((resolve) => {
      ex.get("/", (_req: any, res: any) => {
        res.type("not-a-real-extension");
        res.end();
      });
      const s = ex.listen(0, () => resolve(s));
    });

    try {
      const mine = await fetch(`${running.url}/`);
      const port = (server.address() as AddressInfo).port;
      const theirs = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(mine.headers.get("content-type"), "application/octet-stream");
      assert.equal(theirs.headers.get("content-type"), "application/octet-stream");
    } finally {
      await running.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
