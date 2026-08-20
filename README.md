# zonix

A minimal, zero-dependency HTTP framework for Node.js, written in TypeScript.

Express-compatible middleware, a radix-tree router, and one place where every error ends up — in under 1,600 lines with **no runtime dependencies**. `node:` builtins only.

```ts
import zonix from "zonix";

const app = zonix();

app.get("/users/:id", (req, res) => {
  res.status(200).json({ id: req.params.id });
});

app.listen(3000, () => console.log("http://localhost:3000"));
```

## Why

Express is comfortable but slow and unmaintained-feeling; Fastify is fast but opinionated. zonix is a study in what sits between them: keep the `(req, res, next)` contract that every Node developer already knows, drop the dependency tree, and be honest about performance. It was built to be read as much as used — every design decision below is deliberate.

## Requirements

Node.js >= 20. ESM only (`"type": "module"`).

## Install

```bash
npm install zonix
```

_Not published yet — this repository is the source of record. To use it locally: `npm install && npm run build`, then import from `dist/`._

## Quick start

```ts
import zonix, { parseJSON, cookieParser, cors, serveStatic } from "zonix";

const app = zonix();

// Global middleware runs on every request, in registration order.
app.use(cors({ origin: "https://app.example.com", credentials: true }));
app.use(parseJSON({ limit: "1mb" }));
app.use(cookieParser());
app.use(serveStatic("./public"));

// Route middleware runs after the globals, only for this route.
const requireAuth = (req, res, next) => {
  if (!req.cookies.session) return next(new Error("unauthorized"));
  next();
};

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/users/:id", requireAuth, async (req, res) => {
  const user = await db.find(req.params.id); // throw freely: it lands in handleErr
  res.status(200).json({ user, query: req.query });
});

app.post("/files/*", (req, res) => {
  res.json({ path: req.params["*"] }); // "a/b/c.png" for POST /files/a/b/c.png
});

// One error handler for the whole app. Sync throws, rejected promises and
// next(err) all arrive here.
app.handleErr((err, req, res) => {
  if (err.clientDisconnect) return; // the caller hung up; nothing to say
  console.error(err);
  res.status(err.status ?? 500).json({ error: "Something went wrong" });
});

// Optional: replaces the default 404.
app.fallback((req, res) => res.status(404).sendFile("./public/404.html"));

app.listen(3000);
```

Run the working version of this: `npm run example`.

## API

### Application

| Method                                                                     | Description                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `zonix(options?)`                                                          | Create an app. `options.dev` (default: `NODE_ENV !== "production"`) enables misuse warnings. |
| `app.use(...middleware)`                                                   | Register global middleware. Runs for every request, in order, even when no route matches.    |
| `app.route(method, path, ...middleware, handler)`                          | Register a route.                                                                            |
| `app.get/post/put/patch/delete/head/options(path, ...middleware, handler)` | Sugar for `app.route`.                                                                       |
| `app.handleErr(handler)`                                                   | The central error handler. Only one; a second registration throws.                           |
| `app.fallback(handler)`                                                    | Replaces the default 404. Only one; a second registration throws.                            |
| `app.listen(port, host?, cb?)`                                             | Start listening. Returns the `http.Server`.                                                  |
| `app.address()`                                                            | The bound address, or `null`.                                                                |
| `app.close(cb?)`                                                           | Stop accepting connections.                                                                  |
| `app.server`                                                               | Escape hatch to the raw `http.Server`.                                                       |

### Request

`ZonixRequest extends http.IncomingMessage` — everything stock still works.

| Property      | Description                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| `req.params`  | Route params. `{}` when the route has none; `params["*"]` holds a wildcard tail. |
| `req.query`   | Parsed query string, computed once on first access and cached.                   |
| `req.body`    | `undefined` until a body parser fills it.                                        |
| `req.cookies` | `{}` until `cookieParser()` fills it.                                            |
| `req.path`    | Path without the query string.                                                   |

`params`, `query` and `cookies` are null-prototype objects, so a `__proto__` key is inert data.

### Response

`ZonixResponse extends http.ServerResponse` — everything stock still works.

| Method                               | Description                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `res.status(code)`                   | Set the status. Chainable.                                                  |
| `res.json(data)`                     | Serialize and send, with a byte-exact `Content-Length`.                     |
| `res.redirect(location, code = 302)` | Send a `Location` redirect.                                                 |
| `res.sendFile(path, mime?)`          | Stream a file with backpressure. Returns a promise; `return` it to await.   |
| `res.attachment(filename?)`          | Set `Content-Disposition`, plus `Content-Type` when the extension is known. |

`sendFile` infers the MIME type from the extension. An unknown extension with no explicit `mime` is an error rather than a silent `application/octet-stream` — pass the type you mean.

### Middleware

```ts
import { parseJSON, serveStatic, cookieParser, cors } from "zonix";
```

**`parseJSON({ limit = "1mb", type? })`** — parses `application/json` and `*+json` bodies into `req.body`. Anything else passes through untouched, so GETs and uploads are unaffected. An empty body becomes `{}`. Malformed JSON is a **400**, an oversized body a **413** — measured in bytes, not characters, and rejected from the declared `Content-Length` before a byte is read where possible.

**`serveStatic(root, { index = "index.html", dotfiles = "ignore" })`** — serves files under `root`. A miss calls `next()` rather than answering 404, so routes registered after it still run. A path that escapes `root` is a **403**, checked after resolution so `..` and its encoded forms are both caught. Dotfiles (`.env`) fall through unless you opt in.

**`cookieParser()`** — parses the `Cookie` header into `req.cookies`. Unsigned only in v1. Handles quoted values, `=` inside values, and bad encodings without ever failing a request.

**`cors({ origin = "*", methods, allowedHeaders, exposedHeaders, credentials, maxAge, optionsSuccessStatus = 204 })`** — `origin` takes a string, an array, `true` (reflect the caller), `false`, or a function. Preflights are answered with 204 and never reach the router. `Vary` is set whenever the answer depends on the caller, and `credentials: true` reflects the real origin instead of the illegal `*`.

## How it works

**Custom subclasses, no prototype patching.** `ZonixRequest` and `ZonixResponse` are passed to `http.createServer({ IncomingMessage, ServerResponse })`. Nothing on Node's prototypes is touched, so zonix cannot break another library in the same process. `body`, `params` and `cookies` are declared as class fields, so V8 sees one hidden class per request instead of transitioning object shape mid-flight.

**Radix router, one tree per method.** Each node holds a `Map` of static children, an optional param child and an optional tail wildcard. Matching walks segment by segment, preferring **static > param > wildcard**, and backtracks: if the static branch dead-ends deeper in the tree, the walk retries the param branch at that depth. Captured values ride in a positional array and are zipped with names held on the matched leaf, so `/:id/profile` and `/:username/settings` legally share a param slot. Fully static routes also land in an exact-match `Map` for an O(1) fast path.

Trailing slashes and repeated slashes normalize (`/users`, `/users/` and `//users` are one route). Segments are percent-decoded individually, so an encoded slash stays inside one param; malformed encoding is a 400, never a crash. Paths are case-sensitive, methods are not.

**One chain, one error funnel.** Globals run first, then the matched route's own middleware, then the handler. The runner is recursive: `next()` advances, `next(err)` short-circuits, and a second `next()` from the same middleware is inert. Sync throws and rejected promises are both caught, so no handler needs a `try`/`catch`.

Every error — from the chain, from an ignored `sendFile` promise, from a socket dying mid-stream — ends at one dispatcher that itself never rejects. If the headers are already out it destroys the socket and still tells your handler (so you can log it); otherwise it sets `Connection: close` and calls `handleErr`. If `handleErr` throws, both errors are logged and the client still gets a bare 500. With no handler registered, the default response is `{"error":"Internal Server Error"}` — never a message, never a stack.

**Client disconnects are not failures.** Errors carrying `ECONNRESET`, `EPIPE` or `ERR_STREAM_PREMATURE_CLOSE`, plus any error on a request whose peer has verifiably gone, are tagged `err.clientDisconnect = true` so your logs stay quiet. A client aborting mid-`sendFile` cannot crash the process or leak an unhandled rejection.

**A single-handler fast path.** When a matched route has no global and no route middleware, the handler is invoked directly — no chain array, no chain promise, no per-step closures. That one change moved the hello-world benchmark from 65% to ~89% of Fastify.

## Benchmarks

One hello-world JSON route (`{"hello":"world"}`), `autocannon -c 100 -p 10 -d 10` after a 3s warmup, Node v22.20.0 on Windows 11 (i-series laptop, results are machine-relative):

| Framework | Requests/sec | Latency (ms) | Throughput (MB/s) | vs Express |
| --------- | -----------: | -----------: | ----------------: | ---------: |
| zonix     |      133,862 |         6.97 |              23.9 |       509% |
| express   |       26,307 |        37.36 |               6.3 |       100% |
| fastify   |      149,133 |         6.23 |              26.7 |       567% |

zonix serves ~5× Express and lands within ~11% of Fastify. Fastify keeps its edge largely through schema-compiled serialization, which zonix does not do — `res.json` is `JSON.stringify`.

Reproduce with `npm run bench`. Numbers move by a few percent between runs; the ordering does not.

## Development

```bash
npm install
npm test          # node:test + supertest, 141 tests
npm run typecheck # tsc --noEmit, strict
npm run build     # tsup -> dist/ (ESM + .d.ts)
npm run bench     # the table above
npm run example   # examples/basic.ts on :3000
npm run format    # prettier
```

Tests run against a real HTTP server — nothing about `http` is mocked. Every feature landed with its tests in the same commit.

## Not in v1

Deliberately out of scope, listed so their absence reads as a decision rather than an oversight: HTTP/2, WebSockets, `Range`/206 responses, ETag and caching, compression, clustering, template engines, auth and session helpers, request logging, and schema validation. Signed cookies and HEAD-falls-back-to-GET routing are the two most likely additions.

## License

MIT
