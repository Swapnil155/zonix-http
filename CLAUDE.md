# zonix — Minimal Node.js HTTP Framework

> Project context for Claude Code. Read this fully before writing any code.
> Session state lives in `HANDOFF.md` — read it at session start, update it before session end.

## What this is

A zero-dependency, Express-compatible Node.js HTTP framework in TypeScript, built from scratch by Swapnil as (1) a deep Node.js internals exercise, (2) an interview artifact demonstrating framework design, and (3) a potential base for internal tooling.

Architectural reference: **cpeak** (github.com/Cododev-Technology/cpeak, MIT, ~2,000 LOC). We are building in the same family — custom req/res subclasses, radix router, recursive middleware chain, central error dispatch — but writing our own implementation, not copying files. When stuck on an edge case, cpeak's source is the answer key; understand it, then implement independently.

Working name `zonix` (from Zonixtec). Rename is a find-replace; verify npm availability before any publish.

## Hard constraints (never violate)

1. **Zero runtime dependencies.** `node:` builtins only. devDependencies are fine.
2. **TypeScript strict mode.** `"strict": true`, no `any` except where `http` typings force it (document each).
3. **ESM only.** `"type": "module"`. Node >= 20.
4. **No monkey-patching** `http.IncomingMessage.prototype` / `ServerResponse.prototype`. Extension happens only via subclasses passed to `http.createServer({ IncomingMessage, ServerResponse })`.
5. **Express-compatible middleware signature:** `(req, res, next)` where `next(err)` routes to the error handler. Many Express npm middlewares should work unmodified.
6. **Every feature lands with tests in the same commit.** No untested code merges to `main`.

## Repository layout

```
zonix/
├── CLAUDE.md              # this file
├── HANDOFF.md             # session state (phase, done, next, blockers)
├── package.json
├── tsconfig.json
├── lib/
│   ├── index.ts           # Zonix class, createServer wiring, all exports
│   ├── request.ts         # ZonixRequest extends http.IncomingMessage
│   ├── response.ts        # ZonixResponse extends http.ServerResponse
│   ├── router.ts          # radix tree, one tree per HTTP method
│   ├── errors.ts          # frameworkError(), ErrorCode enum, isClientDisconnect()
│   ├── types.ts           # public types: Middleware, Handler, Next, ZonixOptions
│   ├── internal/
│   │   └── mimeTypes.ts   # extension → MIME map (~30 common types)
│   └── middleware/
│       ├── parseJSON.ts
│       ├── serveStatic.ts
│       ├── cookieParser.ts
│       └── cors.ts
├── test/                  # one file per feature area, node:test + supertest
│   ├── helpers.ts         # makeApp(), listen-on-ephemeral-port helper
│   ├── router.test.ts
│   ├── middleware.test.ts
│   ├── response.test.ts
│   ├── errors.test.ts
│   ├── parseJSON.test.ts
│   ├── serveStatic.test.ts
│   ├── cookieParser.test.ts
│   ├── cors.test.ts
│   └── disconnect.test.ts
├── bench/
│   ├── zonix.js           # hello-world JSON server
│   ├── express.js         # same route in Express
│   ├── fastify.js         # same route in Fastify
│   └── run.sh             # autocannon runner, prints comparison table
└── examples/
    └── basic.ts           # end-to-end usage demo, kept working at all times
```

## Locked design decisions

Do not relitigate these mid-build. If one proves wrong, stop, note it in HANDOFF.md, and ask Swapnil.

1. **Custom subclasses via createServer options.** `ZonixRequest` predefines `body: any = undefined` and `params: StringMap = EMPTY` as class fields so V8 object shape never changes at runtime. `req.query` is a lazy getter backed by a private field: parse once with `URLSearchParams`, cache, return frozen-ish plain object. Empty results return a shared `Object.freeze({})`.
2. **Router = radix tree, one tree per HTTP method.** Node holds `staticChildren: Map`, optional `paramChild`, optional tail `wildcardChild`. Match priority at each depth: **static > param > wildcard**, with backtracking (if the static branch dead-ends, retry the param branch at that depth). Param values captured positionally during the walk; names stored on the leaf and zipped at match time — so `/:id/profile` and `/:username/settings` legally share a param slot. `*` allowed only as final segment; named wildcards (`*name`) rejected at registration with a clear error. Duplicate route registration throws.
3. **Routing normalization.** Strip query string before matching. `decodeURIComponent` each segment, wrapped: malformed encoding → 400, never a crash. Trailing slash policy: **normalize** — `/users` and `/users/` are the same route (collapse at registration and at match). Matching is case-sensitive on path, case-insensitive on method.
4. **Middleware model.** Two layers: global chain (`app.use`) runs in registration order, then the matched route's own middleware array, then the handler. Runner is a recursive async function. `next()` advances; `next(err)` short-circuits to error dispatch; calling `next()` twice from the same middleware is a no-op guarded by a flag (log a warning in dev). Both sync throws and rejected promises from any middleware/handler are caught — developers never need try/catch in handlers.
5. **Central error dispatch** (`#dispatchError`): if `res.headersSent` → `req.socket.destroy()`; else set `Connection: close` and call the registered `handleErr(err, req, res)`. If no handler registered → 500 JSON `{ error: "Internal Server Error" }` (message only, never a stack, in the response). If `handleErr` itself throws → `console.error` both errors, attempt bare 500, swallow. The dispatch promise never rejects — zero unhandled rejections under any input.
6. **Client disconnects are not errors.** `isClientDisconnect(err)` checks codes `ECONNRESET`, `EPIPE`, `ERR_STREAM_PREMATURE_CLOSE`. Tag such errors (`clientDisconnect: true`) so `handleErr` can skip logging noise. A client aborting mid-`sendFile` must never crash the process.
7. **`res.sendFile(path, mime?)`:** `fs.stat` first (ENOENT → framework 404-coded error, not-a-file → error), infer MIME from extension via `mimeTypes.ts` (unknown extension without explicit `mime` arg → throw with actionable message), set `Content-Type` + `Content-Length`, then `await pipeline(createReadStream(path), res)` from `node:stream/promises` for backpressure and error propagation.
8. **404 default:** `res.status(404).json({ error: "Cannot GET /x" })` unless an `app.fallback(handler)` is registered (only one allowed; second registration throws).
9. **Errors are typed.** `frameworkError(message, fn, code)` produces an `Error` with a `code` from `ErrorCode` enum and `Error.captureStackTrace(err, fn)` so stacks start at user call sites.

## Public API surface (target)

```ts
import zonix, { parseJSON, serveStatic, cookieParser, cors } from "zonix";

const app = zonix(); // ZonixOptions later; start with none

app.use(parseJSON({ limit: "1mb" })); // global middleware
app.use(cookieParser());

app.route("get", "/users/:id", authMw, async (req, res) => {
  res.status(200).json({ id: req.params.id, q: req.query });
});
app.get("/health", h); // sugar: get/post/put/patch/delete/head/options
app.post("/files/*", h); // tail wildcard → req.params["*"]

app.handleErr((err, req, res) => {
  if (err.clientDisconnect) return;
  res.status(500).json({ error: "Something went wrong" });
});
app.fallback((req, res) => res.status(404).sendFile("./public/404.html"));

const server = app.listen(3000, () => {}); // overloads: (port), (port, host, cb), (options, cb)
app.address();
app.close(cb);
app.server; // escape hatch to raw http.Server
```

`req` adds: `body`, `params`, `query`, `cookies` (after cookieParser). `res` adds: `status(code)` chainable, `json(data)`, `sendFile(path, mime?)`, `redirect(location, code = 302)`, `attachment(filename?)`. Both otherwise behave as stock `http` objects.

## Build phases

Work strictly in order. A phase is done only when its tests pass, `examples/basic.ts` still runs, and HANDOFF.md is updated. Commit per phase minimum, per feature preferred, conventional commits (`feat:`, `test:`, `fix:`).

**Phase 0 — Scaffold (~30 min).** package.json (ESM, engines >=20, scripts below), tsconfig strict, empty lib/test tree, helpers.ts with `makeApp()` + ephemeral-port listen. Scripts: `build` (tsup lib/index.ts --format esm --dts), `test` (tsx --test test/**/*.test.ts or node --test with tsx loader — pick whichever runs clean on Node 22, document choice), `bench`, `format` (prettier). devDeps only: typescript, tsup, tsx, supertest, @types/node, @types/supertest, prettier, autocannon, express, fastify (bench only).

**Phase 1 — Core loop.** ZonixRequest/ZonixResponse subclasses, Zonix class wiring `http.createServer({ IncomingMessage, ServerResponse })`, flat-Map router (exact paths only, no params yet), global `use()` chain with next/next(err), `res.status/json/redirect`, central error dispatch, default 404, listen/close/address. **Exit test:** hello-world JSON route + middleware order + sync-throw and async-reject both reach handleErr.

**Phase 2 — Real router.** Replace flat Map with the radix tree per decision #2/#3: params, multi-params, tail wildcard, static>param>wildcard priority with backtracking, normalization, duplicate detection, route-level middleware, `app.get/post/...` sugar, `fallback()`. **Exit test:** full router.test.ts suite green including encoded segments and trailing slash.

**Phase 3 — Response + resilience.** `sendFile` with pipeline + MIME map, `attachment`, disconnect handling (decision #6), headersSent guards on every send path, `handleErr`-throws double-fault path. **Exit test:** errors.test.ts + disconnect.test.ts green — including "client aborts mid-file-stream, process survives, no unhandled rejection" (assert via `process.on("unhandledRejection")` trap in the test).

**Phase 4 — Batteries.** `parseJSON` (content-type gate, size limit → 413, malformed → 400, empty body → `{}`; count bytes not chars), `serveStatic(root)` (path-traversal guard: `path.resolve` + `startsWith(root + sep)` check → 403; directory → index.html; unknown MIME → application/octet-stream; missing → next() not 404, so routes can follow), `cookieParser` (unsigned only in v1), `cors` (origin string/array/function, methods, headers, credentials, preflight 204 short-circuit).

**Phase 5 — Bench + polish.** bench/ scripts, autocannon `-c 100 -p 10 -d 10` on hello-world JSON. Record results table in README. Then README with quick start (<5 min to first success), API reference, and a short "how it works" architecture section.

## Non-goals for v1 (do not build, even if tempting)

HTTP/2, WebSockets, Range/206 responses, ETag/caching, compression, clustering, template engine, auth/session helpers, request logging, TypeBox-style schema validation. List them in README as roadmap; keep them out of lib/.

## Test plan

Runner: **node:test** builtin + **supertest** against the app's raw server (`app.server`), TS via tsx. Fast unit-ish integration tests through the real HTTP layer — no mocking `http`. Every test creates its own app on an ephemeral port (or passes the server straight to supertest) and closes it in `after`.

Minimum coverage per area:

- **router:** static, single param, multi param, wildcard capture into `params["*"]`, method isolation (POST /x doesn't match GET /x), static-beats-param, param-beats-wildcard, backtracking case, 404, trailing slash equivalence, encoded segment (`/users/a%20b`), malformed encoding → 400, duplicate registration throws.
- **middleware:** global order, route-level order after global, next(err) skips remaining chain, double-next is inert, async middleware awaited.
- **response:** json sets content-type + serializes, status chains, redirect 302 + custom code, sendFile correct MIME + Content-Length, sendFile ENOENT → handleErr with code, attachment header.
- **errors:** sync throw in handler → handleErr; rejected promise → handleErr; throw after headersSent → socket destroyed, no crash; handleErr itself throws → bare 500 + both errors logged; no registered handleErr → default 500 JSON without stack leak.
- **parseJSON:** valid body populates req.body, invalid → 400, over limit → 413 (test with byte-exact boundary), non-JSON content-type passes through untouched, GET without body unaffected.
- **serveStatic:** serves file, index.html for dir, `../../etc/passwd` traversal → 403, miss falls through to next route.
- **cors:** preflight OPTIONS → 204 with headers, disallowed origin gets no ACAO header, credentials flag.
- **cookieParser:** parses multiple cookies, handles `=` in values, empty header → `{}`.
- **disconnect:** abort mid-response and mid-sendFile — server alive, handleErr sees `clientDisconnect: true`, zero unhandled rejections.

Skip testing: stock `http.Server` behavior, trivial getters.

## Definition of done (v1)

All phases green, `npm test` exits 0 on Node 20 and 22, bench table shows ≥ Express throughput and within ~15% of Fastify on the hello-world route, `examples/basic.ts` runs, README complete, zero `dependencies` in package.json.

## Session workflow

1. **Start:** read HANDOFF.md → confirm current phase and next task in one line → proceed. Don't re-plan finished phases.
2. **During:** test-first where practical (router and error dispatch especially). Run the affected test file after each change, full suite before commit.
3. **End (or when Swapnil says "handoff"):** update HANDOFF.md — phase, completed since last handoff, failing tests if any, exact next task, open questions. Keep it under 30 lines; it's a pointer, not a journal.

## Working style

Terse. Build, don't ask — decisions above are made; only stop for genuine contradictions or when a locked decision proves unworkable. Honest status over optimistic status: a red test suite reported plainly beats a green summary with caveats buried. Never claim benchmarks or test results without having run them.
