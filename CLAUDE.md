# zonix — Minimal Node.js HTTP Framework

> Project context for Claude Code. Read this fully before writing any code.
> Session state lives in `HANDOFF.md` — read it at session start, update it before session end.

## What this is

A zero-dependency, Express-compatible Node.js HTTP framework in TypeScript, built from scratch by Swapnil as (1) a deep Node.js internals exercise, (2) an interview artifact demonstrating framework design, and (3) a potential base for internal tooling.

Architectural reference: **cpeak** (github.com/Cododev-Technology/cpeak, MIT, ~2,000 LOC). We are building in the same family — custom req/res subclasses, radix router, recursive middleware chain, central error dispatch — but writing our own implementation, not copying files. When stuck on an edge case, cpeak's source is the answer key; understand it, then implement independently.

Working name `zonix` (from Zonixtec). **npm status (checked 2026-08):** `zonix` is taken; `zonix-http` and `zonixjs` are free; scoped `@zonixtec/zonix` always works. Pick before Phase 9; rename is a find-replace.

**Scale expectations:** full scope (all phases) lands around 5–7k LOC in `lib/`, 8–10k in `test/`. Phases 0–5 are a 2–4 weekend project; 6–9 roughly double it. This is a marathon repo, not a sprint — phase discipline is what keeps it shippable.

## Current state — v1 SHIPPED (August 2026)

Phases 0–5 are **complete and verified**: 141 tests green on Node 20.20.2 and 22.20.0; `tsc --noEmit`, tsup build and prettier clean; zero `dependencies`. Bench (2 consistent runs, hello-world JSON): **zonix 133,862 rps · Express 26,307 (5.1×) · Fastify 149,133 (zonix at ~90%)**. A no-middleware fast path was added mid-build to get from 65% → 90% of Fastify.

Three findings from the build are now **binding spec amendments** (see "Post-v1 amendments" below). Do not "fix" the code back toward the pre-amendment text.

**As-built layout is the compact v1 tree** (`lib/index.ts`, `request.ts`, `response.ts`, `router.ts`, `errors.ts`, `middleware/`). That is correct for now — the full tree below is the Phase 6 migration target, not a defect.

**Status (Session 5):** 238 tests green (Node 20/22), zero deps. **Phase 6 req surface MERGED** (adversarial review caught 7 defects pre-merge, incl. a real security bug in `req.ips` truncation). **W2 provisionally MET** — routes-200-param: zonix 1.40× Fastify, non-overlapping across 5 interleaved rounds — publication gated on **W2-V** (mechanism flamegraph + scenario-fairness audit, Session 5). Fastify-schema question settled: no schema was ever declared, schema is worth ~1% — the JSON fight was always fair; W3 stands as a range (0.97× hello, 0.99× echo). Harness now stamps **BUSY-MACHINE** (caught a 44% phantom regression from background agents) alongside DEGRADED-REGIME. **Still pending on Swapnil: the AV exclusion** — machine reads 3,489 opens/sec; W1 and exit (c) stay frozen until it lands. **Next: W2-V, then Phase 6 res surface (adversarial review mandatory), per Session 5.**

## Hard constraints (never violate)

1. **Zero runtime dependencies.** `node:` builtins only. devDependencies are fine.
2. **TypeScript strict mode.** `"strict": true`, no `any` except where `http` typings force it (document each).
3. **ESM only.** `"type": "module"`. Node >= 20.
4. **No monkey-patching** `http.IncomingMessage.prototype` / `ServerResponse.prototype`. Extension happens only via subclasses passed to `http.createServer({ IncomingMessage, ServerResponse })`.
5. **Express-compatible middleware signature:** `(req, res, next)` where `next(err)` routes to the error handler. Many Express npm middlewares should work unmodified.
6. **Every feature lands with tests in the same commit.** No untested code merges to `main`.

## Repository layout (full scope — authoritative)

> **Reality check:** v1 shipped on the compact layout and stays there through Phase 5.5. Migration to this tree is the first task of Phase 6 — a pure **restructure commit** (file moves + import updates only, zero behavior change, full suite green before and after, no other changes mixed in).

Phase tags mark when each part comes alive; grow into this tree, do not scaffold it empty on day one. Approximate LOC targets are sanity checks, not quotas. **Where other sections of this doc name a file path in shorthand (e.g. `test/router.test.ts`, `lib/internal/mimeTypes.ts`), this tree is authoritative.**

```
zonix/
├── CLAUDE.md                          # project context (source of truth)
├── HANDOFF.md                         # session state
├── README.md                          # [P9] quick start, compat table, bench table
├── SECURITY.md                        # [P9] disclosure contact, threat model summary
├── CHANGELOG.md                       # [P9] semver history
├── LICENSE                            # MIT
├── package.json                       # zero deps; files:["dist"], exports map
├── tsconfig.json                      # strict, ESM, NodeNext
├── .prettierrc
├── .gitignore
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                     # [P9] Node 20/22/24 matrix · build · test · 90% cov gate
│   │   ├── bench.yml                  # [P9] autocannon regression (informational)
│   │   └── release.yml                # [P9] tag → build → npm publish --provenance
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
│
├── lib/                               # ~5.2k LOC at full scope
│   ├── index.ts                       # [P1] barrel — ONLY file anything external imports
│   ├── app.ts                         # [P1] Zonix class: createServer wiring, listen/close    ~250
│   ├── request.ts                     # [P1] ZonixRequest core: body, params, lazy query       ~150
│   ├── response.ts                    # [P1] ZonixResponse core: status/json/sendFile/redirect ~250
│   ├── types.ts                       # [P1] public types: Middleware, Handler, Options
│   │
│   ├── internal/                      # engine room — never exported
│   │   ├── run-chain.ts               # [P1] recursive middleware runner, next(err), dbl-next  ~120
│   │   ├── dispatch-error.ts          # [P1] central error dispatch, headersSent, double-fault ~100
│   │   └── constants.ts               # [P1] frozen EMPTY, shared symbols                       ~30
│   │
│   ├── router/
│   │   ├── index.ts                   # [P2→P8] Router class, mountable, 4-arity err mw       ~180
│   │   ├── radix.ts                   # [P2] tree: static>param>wildcard, backtracking        ~280
│   │   ├── normalize.ts               # [P2] decode segments, trailing slash, method case      ~80
│   │   └── mount.ts                   # [P8] prefix strip, url rewrite, originalUrl/baseUrl   ~120
│   │
│   ├── errors/
│   │   ├── index.ts                   # [P1] frameworkError(), ErrorCode enum                  ~70
│   │   └── disconnect.ts              # [P3] isClientDisconnect: ECONNRESET/EPIPE/PREMATURE    ~50
│   │
│   ├── compat/                        # Express surface (decision #10) — depends on core, never vice versa
│   │   ├── request.ts                 # [P6] get/path/ip/protocol/hostname/xhr/is/accepts/fresh/range ~350
│   │   └── response.ts                # [P6] send/set/append/type/sendStatus/cookie/locals/vary/format/download ~550
│   │
│   ├── negotiation/                   # in-house negotiator (decision #11) — linear parsers only
│   │   ├── index.ts                   # [P7] q-value sort, specificity, tie-break             ~150
│   │   ├── media-type.ts              # [P7] Accept                                           ~100
│   │   ├── encoding.ts                # [P7] Accept-Encoding (identity;q=0 rules)              ~70
│   │   ├── language.ts                # [P7] Accept-Language                                   ~70
│   │   └── charset.ts                 # [P7] Accept-Charset                                    ~60
│   │
│   ├── http/                          # protocol utilities (inlined 3rd-party equivalents)
│   │   ├── etag.ts                    # [P7] weak ETag, sha1-base64                            ~60
│   │   ├── fresh.ts                   # [P7] If-None-Match / If-Modified-Since → 304           ~80
│   │   ├── range.ts                   # [P7] single-range parse → 206 math                     ~90
│   │   ├── content-disposition.ts     # [P6] RFC 5987 filename* encoding                       ~90
│   │   ├── proxy.ts                   # [P6] trust proxy: CIDR match, presets, ip/ips         ~180
│   │   ├── mime.ts                    # [P3] curated ~120-type map + lookup                   ~100
│   │   └── serialize.ts               # [P5.5] createSerializer — fast-json-stringify equiv   ~150
│   │
│   ├── cookies/
│   │   ├── parse.ts                   # [P4] header → object, handles '=' in values            ~60
│   │   ├── serialize.ts               # [P6] attrs: httpOnly/secure/sameSite/maxAge/domain     ~80
│   │   └── sign.ts                    # [P6] HMAC-SHA256, s: prefix, timing-safe compare       ~60
│   │
│   ├── query/
│   │   ├── simple.ts                  # [P1] URLSearchParams flat (default)                    ~40
│   │   └── extended.ts                # [P8] qs-style: depth≤5, key caps, __proto__ dropped,
│   │                                  #      null-prototype objects                           ~300
│   │
│   ├── body/
│   │   ├── read.ts                    # [P4] shared byte-limited stream reader → 400/413      ~100
│   │   ├── json.ts                    # [P4] content-type gate, empty→{}                       ~80
│   │   ├── urlencoded.ts              # [P8] simple + extended (reuses query/)                 ~90
│   │   ├── raw.ts                     # [P8]                                                   ~50
│   │   └── text.ts                    # [P8] charset-aware                                     ~60
│   │
│   └── middleware/
│       ├── serve-static.ts            # [P4→P7] traversal guard, index.html, miss→next(),
│       │                              #         gains 304/206 in P7                          ~220
│       ├── cors.ts                    # [P4] origin str/array/fn, preflight 204               ~130
│       └── compression.ts             # [P7] gzip/brotli, threshold, Vary, skip-no-benefit    ~220
│
├── test/                              # ~8–10k LOC; mirrors lib/ one-to-one
│   ├── helpers/
│   │   ├── make-app.ts                # ephemeral port, auto-close registry
│   │   ├── raw-client.ts              # net.Socket wire client — 304/206/slowloris need raw bytes
│   │   └── tripwire.ts                # unhandledRejection → fail run; imported by EVERY file
│   ├── core/
│   │   ├── router.test.ts             # [P2] priority, backtracking, encoding, dup-throw
│   │   ├── middleware.test.ts         # [P1] order, next(err), double-next inert
│   │   ├── response.test.ts           # [P1/P3] json/status/redirect/sendFile
│   │   ├── errors.test.ts             # [P3] headersSent race, handleErr-throws double fault
│   │   └── disconnect.test.ts         # [P3] abort mid-stream, process survives
│   ├── compat/
│   │   ├── request.test.ts            # [P6]
│   │   ├── response-send.test.ts      # [P6] Express send inference matrix
│   │   ├── cookies-signed.test.ts     # [P6] wire-compat with cookie-signature format
│   │   ├── router-mount.test.ts       # [P8] nesting, baseUrl, url rewrite
│   │   ├── error-4arity.test.ts       # [P8] runs before handleErr
│   │   └── express-port.test.ts       # [P8] real Express example, import-line-only port
│   ├── http/
│   │   ├── etag-fresh.test.ts         # [P7] 304 matrix
│   │   ├── range.test.ts              # [P7] 206 boundaries, malformed → 200
│   │   ├── negotiation.test.ts        # [P7] q-values, ties, identity;q=0
│   │   └── proxy.test.ts              # [P6] CIDR, spoofed XFF with trust off
│   ├── body/
│   │   ├── json.test.ts               # [P4] byte-exact 413 boundary
│   │   ├── urlencoded.test.ts         # [P8]
│   │   └── raw-text.test.ts           # [P8]
│   ├── middleware/
│   │   ├── serve-static.test.ts       # [P4]
│   │   ├── cors.test.ts               # [P4]
│   │   └── compression.test.ts        # [P7]
│   ├── security/                      # the "production-level" proof
│   │   ├── prototype-pollution.test.ts# query/body/cookies → ({}).polluted === undefined
│   │   ├── path-traversal.test.ts     # encoded, double-encoded, backslash variants
│   │   ├── crlf-injection.test.ts     # redirect/location/set with \r\n payloads
│   │   ├── limits-dos.test.ts         # oversized headers/body behavior
│   │   └── slowloris.test.ts          # headersTimeout/requestTimeout posture (raw-client)
│   └── fuzz/                          # zero-dep, seeded, deterministic
│       ├── rng.ts                     # mulberry32, seed printed on failure for replay
│       ├── query.fuzz.ts              # 10k inputs: defined outcome only, O(n) time cap
│       ├── cookies.fuzz.ts
│       ├── accept.fuzz.ts
│       ├── range.fuzz.ts
│       └── body.fuzz.ts
│
├── bench/
│   ├── servers/
│   │   ├── zonix.js                   # identical hello-world JSON route in each
│   │   ├── express.js
│   │   └── fastify.js
│   ├── run.sh                         # autocannon -c100 -p10 -d10, prints table
│   └── results.md                     # committed history per version
│
└── examples/                          # every example runs in CI — living docs
    ├── basic.ts                       # [P1] kept green from day one
    ├── rest-api.ts                    # [P6] params, body, cookies, errors
    ├── static-site.ts                 # [P7] static + compression + caching
    └── express-migration.ts           # [P8] before/after port demo
```

### Structure rules (enforced, not suggestions)

1. **Import direction is law.** `internal/` and `errors/` import nothing from siblings. Core (`app.ts`, `request.ts`, `response.ts`, `router/`) imports only those. Feature dirs (`compat/`, `negotiation/`, `http/`, `cookies/`, `query/`, `body/`, `middleware/`) import core and each other's **exported entry points only** — never deep paths, never the reverse direction. `lib/index.ts` is the only barrel. Any circular import is a build failure (enforce with a CI lint step).
2. **One directory = one inlined package.** `negotiation/` ↔ negotiator, `http/proxy.ts` ↔ proxy-addr, `query/extended.ts` ↔ qs, `cookies/sign.ts` ↔ cookie-signature, `http/etag.ts` + `http/fresh.ts` ↔ etag + fresh. When behavior is in doubt, diff against the original package's test suite — that is the compat oracle.
3. **test/ mirrors lib/ one-to-one**, plus `security/` and `fuzz/` which mirror nothing — they exist to prove the hardening checklist.
4. **Every new file has exactly one legal home.** If you cannot name the directory in one sentence, stop and fix the boundary — do not create a junk drawer. **A `utils/` folder is banned in this repo.**



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

10. **Express sugar is core, not a shim.** All compat methods (Phases 6–8) are defined directly on `ZonixRequest`/`ZonixResponse` — same subclass mechanism, no runtime patching, no optional plugin. The framework IS Express-surface-compatible by default.
11. **Every third-party capability is inlined with a locked security posture:**
    - **Query parser:** default flat (`URLSearchParams`). `zonix({ queryParser: "extended" })` enables an in-house qs-style nested parser — hard limits (depth ≤ 5, ≤ 1000 keys, sparse-array guard at index > 20), `__proto__`/`constructor`/`prototype` keys silently dropped, results built on null-prototype objects. Same parser backs `urlencoded({ extended: true })`.
    - **Content negotiation:** in-house negotiator for Accept / Accept-Encoding / Accept-Language / Accept-Charset. q-value sorting, specificity rules, **linear parsing only — regexes with nested quantifiers are banned repo-wide (ReDoS)**.
    - **trust proxy:** proxy-addr equivalent (CIDR matching, `loopback`/`linklocal`/`uniquelocal` presets) feeding `req.ip/ips/protocol/hostname`. Default **off**.
    - **ETag + freshness:** weak ETag (sha1-base64 of body, Express-style) + `fresh` logic (If-None-Match / If-Modified-Since → 304).
    - **Cookies:** in-house serializer/parser + HMAC-SHA256 signing via `node:crypto`, `s:` prefix wire-compatible with `cookie-signature`.
    - **Body parsers matching Express core:** `json`, `urlencoded`, `raw`, `text` — all byte-counted limits (413), charset-aware, content-type gated. **Multipart is out of scope until v2** (busboy-class streaming parser, separate project).
    - **MIME:** curated ~120-entry map (not mime-db). Backs `res.type`, `req.is`, `send` inference, static serving. Unknown → `application/octet-stream`.
    - Ban list: no `eval`/`new Function`, no dependency creep "just for one thing", every parser that touches user input ships with a fuzz test.
12. **Router + mounting.** `zonix.Router()` instances mountable via `app.use("/api", router)` and nestable. Mounting rewrites `req.url` (prefix stripped) and preserves `req.originalUrl` + `req.baseUrl`. Express 4-arity `(err, req, res, next)` error middleware is accepted and runs before `handleErr`; `handleErr` remains the final safety net.
13. **`res.send` semantics locked to Express:** string → `text/html` unless `res.type` set; Buffer → `application/octet-stream`; object/array → delegates to `json`; sets ETag when enabled; honors existing Content-Type; `res.send(status)` legacy number form **throws** with a pointer to `sendStatus`.
14. **Conditional GET + ranges** in `send`/`sendFile`/`serveStatic`: 304 on fresh, single-range → 206 + Content-Range + Accept-Ranges, multipart ranges ignored (serve 200 full body — documented).

### Post-v1 amendments (binding — these override the original decision text above)

- **A1 → decision 5 (error dispatch when headers sent):** when `res.headersSent`, the socket is destroyed **and `handleErr` is still invoked** — the original "destroy instead of calling handleErr" reading contradicted the disconnect test's expectations. Consequence: every `handleErr` implementation must guard with `res.headersSent` before writing; the default 500 path already does.
- **A2 → decision 6 (disconnect detection):** probing real aborts showed mid-`sendFile` yields `ERR_STREAM_PREMATURE_CLOSE` (covered) but an aborted write yields `ERR_STREAM_DESTROYED` (was not). The code list now includes `ERR_STREAM_DESTROYED`, and dispatch additionally tags `clientDisconnect: true` whenever the peer is verifiably gone (socket destroyed / `writableEnded` on a dead connection), independent of the error code.
- **A3 → handler typing:** `Handler`/`Middleware` return `unknown`, not `void | Promise<void>` — the idiomatic `(req, res) => res.status(204).end()` must typecheck. Return values are ignored by the runner.

## Public API surface (target)

```ts
import zonix, { parseJSON, serveStatic, cookieParser, cors } from "zonix";

const app = zonix();                       // ZonixOptions later; start with none

app.use(parseJSON({ limit: "1mb" }));      // global middleware
app.use(cookieParser());

app.route("get", "/users/:id", authMw, async (req, res) => {
  res.status(200).json({ id: req.params.id, q: req.query });
});
app.get("/health", h);                     // sugar: get/post/put/patch/delete/head/options
app.post("/files/*", h);                   // tail wildcard → req.params["*"]

app.handleErr((err, req, res) => {
  if (err.clientDisconnect) return;
  res.status(500).json({ error: "Something went wrong" });
});
app.fallback((req, res) => res.status(404).sendFile("./public/404.html"));

const server = app.listen(3000, () => {}); // overloads: (port), (port, host, cb), (options, cb)
app.address(); app.close(cb); app.server;  // escape hatch to raw http.Server
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

**Phase 5.5 — Performance program (run BEFORE Phase 6 — compat work only adds weight; win the speed first and gate it).**

*Step 1 — instrumentation before optimization.* Expand the bench matrix to five scenarios: hello-world JSON, param route (`/users/:id`), 10-middleware chain, 404 path, `sendFile` 1KB and 1MB. Methodology locked: 1 warmup run + 3 measured, report the median; same Node binary; machine, Node version and per-scenario duration recorded in `bench/results.md`; nothing else running; **if sample spread > 5%, rerun (up to 5 samples) and take the median**; every scenario asserts its expected status distribution via autocannon `statusCodeStats` — the 404 scenario passes only when 404s == 100% of responses (non-2xx is the *expected* outcome there; the assertion exists so stray 500s can never hide inside an expected-error scenario). Add an `npm run profile` task (`node --cpu-prof` on the bench server; open in speedscope — `0x` as a devDep is also fine). **Flamegraph before guessing, every time.**

*Step 2 — hypothesis queue, strict order.* Each item: verify the current behavior first (curl -v / flamegraph), implement, re-bench, record the delta in `results.md`. **A change that wins < 1% on its target scenario gets reverted — complexity has a budget.**

1. **`Content-Length` on `res.json`** — verify with `curl -v` whether responses are currently chunked; if so, `Buffer.byteLength` + explicit Content-Length removes chunked-encoding overhead per response. Typical 3–6% on small JSON.
2. **O(1) static-route map in front of the radix walk** — exact `METHOD:path` Map hit before touching the tree (find-my-way does this). Most routes in real apps are static.
3. **Precomposed per-route pipeline** — flatten global + route middleware into one cached array per route (build lazily on first hit; invalidate the cache if `use()` is called after routes start serving). Removes per-request array/closure assembly.
4. **Method keys stored uppercase** — `req.method` arrives uppercase; drop the per-request `toLowerCase()`.
5. **Zero-alloc URL walk** — no `split("/")` array per request; descend the radix tree with `indexOf`-driven segment slicing; keep the shared frozen `EMPTY` params for zero-param matches.
6. **Sync completion path** — only enter async machinery when the handler returns a thenable; a handler that finishes synchronously should cost no microtask.
7. **Serializer decision — the single biggest remaining Fastify edge** (`fast-json-stringify`-class schema serialization). Two options, Swapnil decides and the choice gets recorded here before any code:
   - **Option A (default, keeps the codegen ban):** closure-composed serializers from an optional per-route response schema. Expect ~1.3–1.8× over `JSON.stringify`.
   - **Option B (requires an explicit, narrow ban exception):** code-generated serializers fenced in one file, generated **only** from developer-supplied schemas (never request data), schemas sanitized onto null-prototype objects first. Expect 2–5× on stringify. This is how Fastify/ajv do it, but it is a real relaxation of decision 11's ban — it does not happen silently.
8. **GC audit** — `--trace-gc` during the hello-world bench; the fast path should show no allocation-driven sawtooth.

*Baseline addendum (first full matrix recorded Aug 2026, Node 22.20.0 — raw data in `bench/results.md`).* Ratios vs Fastify: hello 89.1%, param 87.6%, chain 89.9%, 404 91.8%, file-1kb ~98% (within spread), file-1mb ~95%. Vs Express: 5.5–5.9× on every JSON path, **but −16% on file-1kb and −10% on file-1mb — Express wins the file path outright on the same machine, which is proven headroom, not a benchmark artifact.** The JSON gap is flat (~10–12%) across hello/param/chain within spread — a constant per-request cost, not a router or middleware scaling problem. Revised execution order, which supersedes the raw item numbering above:

1. Flamegraph **hello AND file-1kb** (rule unchanged: no optimization without a profile).
2. Item 1 — Content-Length on `res.json`; verify chunked with `curl -v` first.
3. **NEW — small-file buffered send:** files ≤ 32KB go `fs.readFile` → single `res.end(buf)` instead of stream + pipeline. Identical headers/MIME/error semantics; the disconnect suite and fast-path equivalence rule apply in full. Target: ≥ Express (14.0k) on file-1kb.
4. **NEW — file-path overhead audit:** promise `fs.stat` + `stream/promises.pipeline` vs callback `stat` + `.pipe()` with manual error wiring, and `highWaterMark` sizing for the 1MB case. Driven strictly by the flamegraph; disconnect tagging and backpressure correctness are non-negotiable — any change here re-runs the full disconnect suite.
5. Items 2–6 as written — they attack the flat JSON gap.
6. **Serializer attribution check before item 7:** confirm whether `bench/servers/fastify.js` declares a response schema. If it does **not**, `fast-json-stringify` is not active in this matrix, the ~11% gap is lifecycle/allocation cost rather than serialization, and item 7's expected yield drops. In that case add a fourth variant `fastify-schema.js` to expose Fastify's true ceiling **before** choosing Option A vs B.

*Session 2 addendum (Aug 2026 — items 1–7 adjudicated; raw data + methodology in `bench/results.md`).* Profile facts on record: zonix self-time was **3.9%** of a hello-world request entering this session (`writev` 45%, `_storeHeader` 2.3%, `setHeader` 1.6%, `res.json` 2.15% — the framework is a thin slice of its own benchmark). Machine end-to-end noise floor ≈ **5%** (same build A/B'd against itself across four harness designs; Fastify drifted +21% between sessions, same build). Consequence: e2e deltas below ~5% are unmeasurable here; the paired-process microbench and self-time share are the official instruments for sub-noise work.

Verdicts: items 1–2 were already true in v1. Item 3 (precomposed pipeline, **+5.04% e2e**, 5/5 pairs positive) and item 6 (sync completion, **+6.46% e2e**; chain went **86.1% → 98.2%** of hello-world, same-session ratio) kept on e2e evidence. Items 4–5 kept on microbench + self-time evidence under amended rule 5: item 4 deletes a per-request allocation (zero complexity), item 5 (+29–47% on the walk for ~45 lines) is justified by route-count scaling — the walk's share of a request grows with real route tables (the bench has 2 routes; real apps have 50–200), and it carries its own microbench + equivalence tests.

**Decisions (binding):**

- **D1 — Serializer: Option A. The codegen ban stands.** Measured: most of the win is the linear char-scan escaping, not codegen (naive closure was 0.94× on a realistic payload; tuned closure 1.24–3.20×). B's edge over tuned A is +0.3–0.8% e2e — under the noise floor; by rule 5 it wouldn't survive as a standalone change, so it cannot justify relaxing decision 11. A ships as an **opt-in feature, not a hot-path change**: export `createSerializer(schema)` (closure-composed, char-scan escaping — the escaping technique is the reusable asset). No change to existing route or `res.json` signatures; route-level schema wiring is a Phase 6+ candidate. Pay-for-what-you-use: zero cost when unused. Ships with its own microbench and an escaping fuzz test (`test/fuzz/`).
- **D2 — The ≥95%-of-Fastify e2e gate is dead** — it read 89.1% and 108% on the same build in different sessions; a gate that cannot be measured is not a gate. Replaced by the revised exit below. Cross-framework numbers may only be claimed from **same-session interleaved paired runs**, always reported as a **range with the noise floor stated** — including in the README. Honest benchmarking is a deliberate, visible feature of this project.
- **D3 — Header experiment, one bounded shot.** The profile says headers (~3.9% combined) now outweigh serialization (2.15%): batch `res.json`'s header writes into a single `writeHead(status, headersObj)`. Judge **by self-time share only**. If the `_storeHeader`/`setHeader` share doesn't drop meaningfully, stop and record it: that is the practical ceiling of `node:http`, no further e2e chasing — from then on speed is guarded (regression gate + instruments), not chased. (`writev` at 45% is Node core + kernel; reaching past it means leaving `node:http`, which this project does not do.)
- **D4 — The file items are still open and are the priority.** Buffered small-file send and the file-path audit were not executed in session 2. They are the one place with proven headroom against Express (−16% on file-1kb) **and** the one place where the gap is far above the noise floor, so plain e2e adjudication works. Phase 5.5 does not close without them.

*Exit (revised — every criterion measurable):* (a) **dispatch self-time ≤ 1.5%** on the hello-world profile, excluding exactly the response-body-encode frames (see Session 3 addendum for the binding definition; the excluded frame list is pinned in `results.md` and may not grow without a decision recorded here) — total self-time including encode is reported alongside it every session, ungated; (b) chain ≥ **95%** of hello-world same-session (currently 98.2% ✓); (c) **file-1kb ≥ Express**, plain e2e, **valid only in a session whose regime preflight passes** (rule 7) — unadjudicable until the AV exclusion is in place; (d) `createSerializer` shipped with microbench + escaping fuzz; (e) header experiment run and recorded either way; (f) no same-session paired regression on any scenario; (g) `results.md` documents the noise floor and instrument methodology as the repo's permanent benchmarking standard. Fastify: reported as a same-session paired range — an honest number and an aspiration, not a merge gate.

*Session 3 addendum (Aug 2026 — **Phase 5.5 CLOSED**).* File items: **F1** buffered send ≤ 32KB, **+98.4% paired e2e** (file-1kb 11.5k → 23.0k — above every Express reading ever recorded on this machine, including its best of 14.0k — *withdrawn in Session 4: the matrix spanned two machine regimes*), with a buffered-path disconnect test and six threshold tests either side of 32KB. **F2** callback `fs` over `fs/promises` kept on self-time (stat wrapper 2.37% → 0.26%, GC share 6.0% → 2.6%; e2e inconclusive — rule 5 tiering applied as designed). **F3** 256KB highWaterMark reverted (−7.6%, every pair negative). **F4** `.pipe()` over `pipeline()` **declined, and the decline is endorsed**: ≤ 2.4% ceiling on a 23.8%-idle path, and `pipeline`'s abort semantics are precisely where the disconnect guarantees live — revisit only if a real workload ever shows the > 32KB stream path hot. `createSerializer` shipped per D1: median 1.24×, 3.52× on small objects; two variants (hand-rolled array loop 0.75×, join-based 0.54×) were rejected by measurement and arrays now delegate to `JSON.stringify` — "never materially slower" is a tested property, not a hope; 10k-input seeded fuzz with byte-parity against `JSON.stringify`, lone surrogates and schema mismatches included. Header batching kept (header self-time 3.90% → 1.79%, `setHeader` gone from the profile); the byteLength follow-on measured worse and was reverted.

**Exit (a) redefined (binding).** The criterion's intent is the *framework tax*: cycles zonix adds beyond what any `node:http` app doing the same work must pay. Response-body encoding (`JSON.stringify` inside `res.json`, or the serializer) is application work every framework performs, and D1 deliberately forecloses the codegen route to shrinking it — so gating on it makes the gate unreachable by decision, not by defect. (a) is now **dispatch self-time ≤ 1.5%, excluding exactly the response-body-encode frames**; the excluded list is pinned in `results.md` and may not grow without a decision recorded in this file. Currently ~1.16% ✓. The total including encode (3.1% this session) is reported every session, ungated — the gate narrows; the reporting never does. With that, (a)–(g) are met.

**BI-1 — bench-integrity investigation (OPEN; blocks any cross-framework claim and the Phase 9 README — does not block Phase 6 code).** This session Express file-1kb read **4,270 vs 14,034 last session** and Fastify **4,225 vs 12,073** — both collapsing ~68%, to within ~1% of *each other*, while zonix doubled. Per rule 6 that is a harness or environment defect until proven otherwise. Required, in order: (1) `git diff` the bench harness and competitor server files against the last session's commit; (2) confirm Express still serves via its optimized path (`res.sendFile`/`express.static`) and Fastify via the same mechanism as the prior session; (3) rerun the file scenarios three-way, interleaved, in a single session; (4) if the collapse reproduces on a verified-identical harness, identify and document the environmental cause (page-cache state, antivirus real-time scanning of the bench file, etc.) in `results.md`. Until BI-1 closes, this session's competitor file numbers are marked **ANOMALOUS** in `results.md`, and the only publishable file claim is the paired **+98.4%**. *(Session 4 correction: the absolute 23.0k is withdrawn too — BI-1 proved the session-3 matrix itself measured zonix in the fast regime and the competitors in the slow one.)* Also on record: hello spread breached tolerance this session (13.6%, one 125.7k outlier; median-of-5 stands, breach logged), and file-1mb has exceeded 5% spread at 5 samples in both sessions — the 1MB scenario is **permanently low-confidence on this rig**; no claims are built on it.

Same-session standing vs Fastify this session: hello 96.9%, param 95.1%, chain 95.8%, 404 98.7% — published, per D2, only as the honest range (**~95–99% of Fastify, same-session interleaved, ±5% noise floor**).

*Session 4 addendum (Aug 2026 — BI-1 closed; restructure merged; the Beat-Fastify program).*

**BI-1 verdict: the anomaly was ours — more precisely, the machine's.** Competitor harness files byte-identical; serving paths verified healthy live. The interleaved rerun collapsed **all three** frameworks to ~4.2–4.4k, including zonix (4,199 vs its own 23,026 minutes earlier), and the control isolated the cause: system-wide `open()` throttling at 3.4–3.9k/sec (~260µs) from a filesystem filter driver (AV real-time scanning — `os.tmpdir` equally slow), while reads on an open fd run 170× faster. The session-3 matrix measured zonix in the fast regime and the competitors in the slow one; a sequential matrix charges a mid-run regime flip to whoever benches later. **Withdrawn:** 23,026 absolute, "5.4× Express," "above every Express reading," and exit (c) adjudication on this rig until the regime is fixed. **Survives:** F1's +98.4% — paired, interleaved, 5/5 positive, mechanistically confirmed (GC 20.3% → 2.6%, DOMException 11.1% → 0). Rule 7 (regime preflight) exists because of this. **Manual action (Swapnil, admin-level): add the AV exclusion for the repo and bench fixture directories** — Claude Code cannot do this.

**Restructure commit: merged and accepted**, including all three deviations, which were correctly reasoned: `http/serialize.ts` now has its slot in the authoritative tree; `body/read.ts` stays unsplit until Phase 8 actually shares it; `test/helpers/raw-client.ts` is created when the first raw-wire test needs it, not before — scaffolding empty files violates the tree's own grow-into-it rule.

**D5 — route-level serialization wiring (binding API decision):** a higher-order wrapper, not a signature change: `serialized(schema, handler)` exported from the barrel — the wrapped handler returns data, the wrapper serializes with the compiled schema and ends the response with correct headers. Zero change to `route()`/`res.json`; pay-for-what-you-use; enables schema-vs-schema benchmarking against Fastify.

**The Beat-Fastify program — the honest arithmetic first.** Total zonix self-time on hello-world is **3.1%** (dispatch ~1.16% + response encode ~1.94%). A framework with literally zero cost would therefore beat us by at most ~3% — which means raw `node:http` itself sits only a few percent above Fastify, and so do we. **A decisive (> noise floor) hello-world victory inside `node:http` is arithmetically unavailable — to us, to Fastify, to anyone.** The crown is won where architecture can actually differ. Win conditions, all measurable:

- **W1 — files, decisively (structural).** Buffered ≤32KB path + opt-in memory cache + 304s (Phase 7 stack) vs competitors' stream-per-request. Adjudicated only under a passing regime preflight. Target: an unambiguous multiple, with mechanism stated.
- **W2 — one realistic scenario, decisively.** `routes-200-param` (router at scale — where the zero-alloc walk and radix design were built to matter; a 2-route bench hides routing entirely) and `post-json-echo`. Target: win ≥ 1 outright, above noise.
- **W3 — statistical parity on the micro JSON scenarios.** Schema-vs-schema via D5 (first: confirm whether `bench/servers/fastify.js` declares a response schema — the session-2 attribution check is still unconfirmed; if yes, our current 95–99% is us-without-schema vs them-with, and D5 closes an unfair gap). Target: ≥ parity in half of paired sessions — reported as the range, never a cherry-picked single run. *(Settled in Session 5: no schema was ever declared in the Fastify bench — every recorded matrix was already stringify-vs-stringify, and the added schema variant is worth ~1%, not the gap. The fight was always fair; D5's `serialized()` is an API feature, not a performance play.)*

Explicitly out of scope: leaving `node:http` for a hand-rolled HTTP/1.1 parser on raw sockets (uWebSockets territory). It is the only route to a decisive hello-world number, and it costs months, a security-critical parsing surface, and the `IncomingMessage`/`ServerResponse` compatibility layer this project is built on. Recorded as a v3 research question, not a plan. The claimable crown, once W1–W3 hold: **zero dependencies, Express-compatible, ~2k-line core, 5–6× Express, statistical parity with Fastify on micro-benchmarks, decisive wins where architecture matters — published with error bars.** That last clause is the moat: nobody else's benchmark page has one.

*Session 5 addendum (Aug 2026 — preflight live, W2 provisionally met, req surface merged).*

**Instrumentation:** `bench/regime.mjs` wired into all three harnesses; this rig still reads **3,489 opens/sec — DEGRADED-REGIME**, so file scenarios remain unadjudicable until the AV exclusion (Swapnil, manual, still pending). The preflight's first catch was *us*: a sequential run reported hello at 80,787 vs 145,779 an hour earlier — background agents; the harness now stamps **BUSY-MACHINE** from system-wide utilization sampling (rule 7 amended), and the quiet re-run read 142,963.

**First numbers (interleaved, quiet machine, 5 rounds):** hello 142,963 vs Fastify 147,904 (**0.97×**, 5.49× Express); routes-200-param **135,309 vs 96,480 (1.40×**, 6.05× Express); post-json-echo 62,134 vs 62,787 (**0.99×**, 3.74× Express). Scaling 6 → 200 routes costs zonix 5.4% and Fastify 34.8%.

**W2: provisionally met — publication gated on W2-V (binding).** The distributions don't overlap across five rounds, but no mechanism has been claimed, and a 35% find-my-way degradation is surprising enough that it is either a genuine scaling weakness (excellent) or a scenario artifact (fatal if published, then debunked). W2-V requires, before the number appears anywhere public: (1) flamegraph Fastify at 200 routes and name the mechanism; (2) publish the scenario spec next to the result — route shapes, registration order, request-path distribution, Fastify config confirmed default; (3) add a **param-at-6-routes control** so table-size cost is isolated from static-vs-param request type (the current 6→200 comparison conflates both); (4) confirm zonix's own win survives the control. W2 ships with a mechanism or it does not ship.

**W3 downgraded to "effectively a tie," and that's the honest reading:** with schema settled at ~1%, the remaining hello gap (~3%) is lifecycle inside the noise floor. The claimable range is **0.95–1.0× Fastify, same-session interleaved** — no single-number claim, per D2.

**D6 — `req.host` follows Express 5 semantics (binding):** returns host **including port** when present (honoring trust proxy via X-Forwarded-Host, IPv6-bracket safe); `req.hostname` is the port-stripped form. Rationale: compat targets Express as it ships today (v5 stable); v4's host-as-alias-of-hostname is a documented wart. The v4 difference goes in the README compat table. Deferral of `accepts()`/`fresh`/`range()` to Phase 7 is **approved** — their machinery is tree-tagged [P7]; implementing them early would drag the negotiator forward.

**Process ruling:** the adversarial-review pattern that caught the `req.ips` truncation bug (first draft returned the entire attacker-controlled X-Forwarded-For chain), the IPv6 `split(":")` trap, `is()` returning the matched string, and `+json` suffix expansion is **mandatory for the res surface** — its traps are named in advance: CRLF in `redirect`/`location`/`set`, cookie attribute serialization, `content-disposition` filename encoding, and the `send` content-type inference matrix. Regression gate: PASS (+0.07% / +0.42% / −1.44%, inside budget).

**Phase 6 — Express req/res surface (decision #10, #13).** Opens with the **restructure commit** (compact layout → full tree, pure moves, suite green before/after) — no compat code lands until that is merged. `req`: `get/header`, `path`, `originalUrl`, `baseUrl`, `ip`/`ips` (trust proxy), `protocol`/`secure`, `hostname`/`subdomains`, `xhr`, `is()`, `accepts()` family, `fresh`/`stale`, `range()`. `res`: `send`, `set/get/append`, `type`, `sendStatus`, `cookie/clearCookie` (incl. signed), `locals`, `vary`, `format`, `links`, `location`, `redirect("back")`, `download()`, proper `content-disposition` filename encoding. **Exit test:** `test/compat/req.test.ts` + `res.test.ts` green, and a handler copy-pasted from the Express docs runs unmodified.

**Phase 7 — Negotiation, caching, compression (decision #11, #14) — now also the W1 static stack (see Beat-Fastify program).** Adds: opt-in in-memory asset cache for `serveStatic` (`{ cache: { maxBytes } }` — LRU, byte-capped, mtime-revalidated per hit, off by default per pay-for-what-you-use), and three bench scenarios: `routes-200-param` (200-route table, param-heavy), `post-json-echo`, and file-1kb re-adjudication under a passing regime preflight. In-house negotiator wired into `accepts`/`format`/static serving; ETag + fresh → 304s across `send`/`sendFile`/`serveStatic`; single-range 206; `compression()` middleware (gzip/brotli via `node:zlib`, threshold, Accept-Encoding negotiation, `Vary: Accept-Encoding`, skip-if-no-benefit). **Exit test:** wire-level assertions for 304, 206, and correct Content-Encoding under each Accept-Encoding permutation.

**Phase 8 — Router, mounting, remaining parsers (decision #11, #12).** `Router` class, path-mounted `use`, nested mounts, url rewrite + `originalUrl`/`baseUrl`, 4-arity error middleware, `urlencoded`/`raw`/`text` parsers, extended query parser with its pollution + fuzz suites. **Exit test:** a small real Express example app (routes, two mounted routers, error middleware) ported by changing only the import line.

**Phase 9 — npm publish pipeline.** Decide name (`zonix-http` / `zonixjs` / `@zonixtec/zonix` — see naming note). package.json: `exports` map with `types`, `files: ["dist"]`, `sideEffects: false`, `engines.node: ">=20"`, repository/keywords/MIT. tsup build (esm + dts + sourcemaps). GitHub Actions CI: test matrix Node 20/22/24, build, coverage gate. Publish **with provenance** from CI on version tags (`npm publish --provenance --access public`). Semver discipline: stay `0.x` while the API can move; **v1.0.0 only after the dogfood gate** (below). README gets: install, quick start, Express-compat table (what works / differs), bench table, SECURITY.md with a disclosure contact.

## Performance rules (permanent — apply to every phase from here on)

1. **Pay for what you use.** Compat sugar (Phase 6+) must be lazy: accessor-based, computed on first touch. A request that never reads `req.hostname` or `req.accepts()` pays zero for their existence. No per-request precomputation of convenience fields, ever.
2. **Regression gate:** no more than **2% per phase** on hello-world, adjudicated by **same-session paired A/B** (previous build vs new build, interleaved, ≥ 5 pairs, median) — never by comparing medians across sessions: session-to-session drift on this machine (~5% noise floor, Fastify observed drifting +21%) exceeds the gate itself. Numbers go into HANDOFF.md at every phase close; a phase is not done while the gate is broken.
3. **Fast paths are guarded, not trusted.** The no-middleware fast path (and any future one) must (a) route errors through the same central dispatch — no duplicated dispatch logic — and (b) ship with an **equivalence test**: the same route exercised via fast path and via slow path (forced with a no-op middleware) must produce byte-identical wire output. This is the guard against the classic fast-path drift bug.
4. **ETag defaults off** at the app level (`etag: false`) — a deliberate deviation from Express, because default-on means hashing every response body. Documented in the README compat table; opt-in per app or per route.
5. **No optimization without a number — at the right resolution.** Expected effect ≥ the noise floor (~5% e2e on this machine): plain before/after medians. Below that: **paired-process microbench and profile self-time share** (within-run ratios, so drift cancels) — the instruments built in Phase 5.5 session 2, permanent residents of the repo. Every kept micro-optimization carries its own microbench and an equivalence test. The complexity budget is unchanged in spirit: a change whose best honest measurement cannot distinguish it from zero gets reverted, whatever the theory says.
6. **Anomaly protocol.** Any number — ours or a competitor's — that moves ≥ 2× session-over-session is treated as a harness or environment defect first: `git diff` the harness, rerun interleaved in one session, and only then record it as fact. A competitor collapsing is not a victory; it is a bug in the measurement until shown otherwise, and no claim ships on it.
7. **Regime & load preflight.** Before any file scenario, the harness measures raw `open()`/close throughput *and* reads-on-an-open-fd on the bench fixture (the ratio separates a filter driver from a slow disk) and records both in `results.md`. Before **every** scenario, it samples system-wide CPU utilization and stamps the session **BUSY-MACHINE** when background load is present — a session-5 phantom (−44% on hello, Express −40%, Fastify untouched because it benched last) came from background agents, and a spin-loop probe was correctly rejected because one thread on a 24-core box grabs an idle core and reports all-clear. Below 50,000 opens/sec the machine is in a degraded regime (filesystem filter driver / AV interference): file scenarios still run but are stamped **DEGRADED-REGIME**, and no cross-framework or absolute claim may be built on them. Discovered via BI-1: a filter driver throttled `open()` system-wide to ~3.4–3.9k/sec (~260µs each) while reads on an open fd ran 170× faster — every framework pins at that ceiling, and a mid-run regime flip charges the change to whichever framework benches later.

## Non-goals (all versions — do not build, even if tempting)

HTTP/2, WebSockets, multipart/file uploads (busboy-class problem — v2 candidate), clustering, template engine, auth/session helpers, request logging, schema validation, JSONP, `app.param()`, regex route paths. (Ranges, ETag/caching and compression are **not** non-goals anymore — they're scheduled in Phase 7. During Phases 0–5 they stay out.) List the rest in README as roadmap; keep them out of lib/.

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

## Production-hardening checklist (what "production-level" means in this repo)

Production-grade is a set of properties, not a line count. All of these are enforced, not aspirational:

- **Fuzzing:** every user-input parser (query extended, cookies, accept-*, range, JSON limits, urlencoded) has a seeded-RNG fuzz loop in `test/fuzz/` (hand-rolled, zero-dep) — 10k random inputs per parser must produce only defined outcomes (parse result or 4xx), never a throw that escapes, never > O(n) time blowup.
- **Security suite** (`test/security/`): prototype pollution attempts through query/body/cookies (assert `({}).polluted === undefined` after), path traversal batteries against serveStatic, CRLF injection attempts in `redirect`/`location`/`set`, oversized header and body behavior, and slowloris posture — server ships with `headersTimeout`/`requestTimeout` defaults documented and tested.
- **Zero unhandled rejections:** every test file installs a `process.on("unhandledRejection")` tripwire in setup that fails the run.
- **CI gates:** Node 20/22/24 matrix, coverage ≥ 90% lines on `lib/`, bench job (informational, catches order-of-magnitude regressions).
- **Dogfood gate for v1.0.0:** the framework must run one real internal Zonixtec service (or a personal production app) for ~a month of real traffic with no framework-caused incident before the 1.0 tag. Until then it's 0.x and the README says so honestly.

## Definition of done (v1)

**✅ MET (August 2026).** 141 tests on Node 20.20.2 + 22.20.2, clean typecheck/build/format, zero runtime deps, 5.1× Express and ~90% of Fastify on hello-world (target was ≥85%), example smoke-tested over curl. v1 is frozen; further speed work happens under Phase 5.5 with its own exit bar.

## Definition of done (v2 — full compat + npm)

Phases 6–9 green, hardening checklist fully enforced in CI, the Express example-app port test passes, compat table in README is accurate (verified against real Express behavior, not assumed), package published as 0.x with provenance, and the dogfood gate is the only thing standing between the repo and v1.0.0.

## Session workflow

1. **Start:** read HANDOFF.md → confirm current phase and next task in one line → proceed. Don't re-plan finished phases.
2. **During:** test-first where practical (router and error dispatch especially). Run the affected test file after each change, full suite before commit.
3. **End (or when Swapnil says "handoff"):** update HANDOFF.md — phase, completed since last handoff, failing tests if any, exact next task, open questions. Keep it under 30 lines; it's a pointer, not a journal.

## Working style

Terse. Build, don't ask — decisions above are made; only stop for genuine contradictions or when a locked decision proves unworkable. Honest status over optimistic status: a red test suite reported plainly beats a green summary with caveats buried. Never claim benchmarks or test results without having run them.