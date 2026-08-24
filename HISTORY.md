# zonix — PROJECT HISTORY (full chronicle)

> **Not auto-loaded. Do not read this file at session start.** This is the complete
> decision chronicle: every session addendum, every withdrawn claim, every
> investigation narrative, in original wording. Every outcome that remains BINDING
> is summarized in CLAUDE.md — consult this file only when a question needs
> provenance ("why was X decided", "what exactly did session N measure").

---

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

**Status (Session 16): the matrix is in — and it handed us one withdrawal and one gift.** Post-audit container matrix, four frameworks, verbatim in `results.md` (`82cc79a`). Headlines: zonix 5.6–6.6× Express everywhere; 0.91–0.98× Fastify's fast band on small tables; **1.37× at 200 routes (harness-configuration-qualified — see below)**; **1.76× Express / 1.43× Fastify / 1.84× cpeak on file-1kb**; zonix leads cpeak 1.11–1.84× on six of seven scenarios. **The withdrawal:** ROUNDS=20 on the minimal repro read fast-mode 8/20 at six routes and **9/20 at two hundred** — the same ~45% lottery, independent of table size; "200 routes were never observed in the fast mode" is withdrawn. What survives is narrower: **our** bench server's 200-route configuration is 0/13 fast while its 6-route is 16/16 (~0.03% as coincidence) — a property of `bench/servers/fastify.js` at 200 routes, suppressor unidentified → folded into MH-1; ISSUE.md regated on a V8-level mechanism. W2's zonix half (flat, unimodal, deterministic) is untouched and now leads the claim. **The gift: cpeak beats zonix 1.71× on post-json-echo (76,134 vs 44,432) — and beats Fastify and Express there too.** First decisive zonix loss anywhere, 10× the noise floor, fully adjudicable — the body-ingestion path has a real mechanism gap. **Next: ECHO-1 (close it legally, guards intact), then MH-1 (mode mechanism + harness suppressor), then Phase 7 — firmly.**

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
- **W2 — one realistic scenario, decisively.** `routes-200-param` (router at scale — where the zero-alloc walk and radix design were built to matter; a 2-route bench hides routing entirely) and `post-json-echo`. Target: win ≥ 1 outright, above noise. *(Session 6 verdict: MET, narrowed — the durable claim is flat scaling 6→400 while Fastify cliffs ~30% between 50–100 routes; see Session 6 addendum for the binding publication wording.)*
- **W3 — statistical parity on the micro JSON scenarios.** Schema-vs-schema via D5 (first: confirm whether `bench/servers/fastify.js` declares a response schema — the session-2 attribution check is still unconfirmed; if yes, our current 95–99% is us-without-schema vs them-with, and D5 closes an unfair gap). Target: ≥ parity in half of paired sessions — reported as the range, never a cherry-picked single run. *(Settled in Session 5: no schema was ever declared in the Fastify bench — every recorded matrix was already stringify-vs-stringify, and the added schema variant is worth ~1%, not the gap. The fight was always fair; D5's `serialized()` is an API feature, not a performance play.)*

Explicitly out of scope: leaving `node:http` for a hand-rolled HTTP/1.1 parser on raw sockets (uWebSockets territory). It is the only route to a decisive hello-world number, and it costs months, a security-critical parsing surface, and the `IncomingMessage`/`ServerResponse` compatibility layer this project is built on. Recorded as a v3 research question, not a plan. *(Upgraded in Session 7 planning to the gated **Turbo track** — see Path to First, M4: a cheap falsifiable spike decides whether it lives, before any real investment.)* The claimable crown, once W1–W3 hold: **zero dependencies, Express-compatible, ~2k-line core, 5–6× Express, statistical parity with Fastify on micro-benchmarks, decisive wins where architecture matters — published with error bars.** That last clause is the moat: nobody else's benchmark page has one.

*Session 5 addendum (Aug 2026 — preflight live, W2 provisionally met, req surface merged).*

**Instrumentation:** `bench/regime.mjs` wired into all three harnesses; this rig still reads **3,489 opens/sec — DEGRADED-REGIME**, so file scenarios remain unadjudicable until the AV exclusion (Swapnil, manual, still pending). The preflight's first catch was *us*: a sequential run reported hello at 80,787 vs 145,779 an hour earlier — background agents; the harness now stamps **BUSY-MACHINE** from system-wide utilization sampling (rule 7 amended), and the quiet re-run read 142,963.

**First numbers (interleaved, quiet machine, 5 rounds):** hello 142,963 vs Fastify 147,904 (**0.97×**, 5.49× Express); routes-200-param **135,309 vs 96,480 (1.40×**, 6.05× Express); post-json-echo 62,134 vs 62,787 (**0.99×**, 3.74× Express). Scaling 6 → 200 routes costs zonix 5.4% and Fastify 34.8%.

**W2: provisionally met — publication gated on W2-V (binding).** The distributions don't overlap across five rounds, but no mechanism has been claimed, and a 35% find-my-way degradation is surprising enough that it is either a genuine scaling weakness (excellent) or a scenario artifact (fatal if published, then debunked). W2-V requires, before the number appears anywhere public: (1) flamegraph Fastify at 200 routes and name the mechanism; (2) publish the scenario spec next to the result — route shapes, registration order, request-path distribution, Fastify config confirmed default; (3) add a **param-at-6-routes control** so table-size cost is isolated from static-vs-param request type (the current 6→200 comparison conflates both); (4) confirm zonix's own win survives the control. W2 ships with a mechanism or it does not ship.

**W3 downgraded to "effectively a tie," and that's the honest reading:** with schema settled at ~1%, the remaining hello gap (~3%) is lifecycle inside the noise floor. The claimable range is **0.95–1.0× Fastify, same-session interleaved** — no single-number claim, per D2.

**D6 — `req.host` follows Express 5 semantics (binding):** returns host **including port** when present (honoring trust proxy via X-Forwarded-Host, IPv6-bracket safe); `req.hostname` is the port-stripped form. Rationale: compat targets Express as it ships today (v5 stable); v4's host-as-alias-of-hostname is a documented wart. The v4 difference goes in the README compat table. Deferral of `accepts()`/`fresh`/`range()` to Phase 7 is **approved** — their machinery is tree-tagged [P7]; implementing them early would drag the negotiator forward.

**Process ruling:** the adversarial-review pattern that caught the `req.ips` truncation bug (first draft returned the entire attacker-controlled X-Forwarded-For chain), the IPv6 `split(":")` trap, `is()` returning the matched string, and `+json` suffix expansion is **mandatory for the res surface** — its traps are named in advance: CRLF in `redirect`/`location`/`set`, cookie attribute serialization, `content-disposition` filename encoding, and the `send` content-type inference matrix. Regression gate: PASS (+0.07% / +0.42% / −1.44%, inside budget).

*Session 6 addendum (Aug 2026 — W2-V passed and narrowed; res surface merged).*

**W2-V verdict: the control did its job.** routes-6-param: zonix 117,254 vs Fastify 120,422 (**0.97×** — Fastify ahead); routes-200-param: 115,994 vs 82,720 (**1.40×**). So the win is **entirely table-size scaling**: with the confound removed, 6→200 costs zonix **1.1%**, Express 10.1%, Fastify **31.3%**. Mechanism characterized without over-claiming: find-my-way's `find` is flat (1.2–1.4% at both sizes); what grows is `process.nextTick` (0.96% → 21.94%); the sweep shows a **cliff between 50–100 routes** (flat before, flat after to 400) — and four candidate explanations were tested and rejected (distinct handler closures, path variety, schema compilation, GC). Fastify's internals were not root-caused; that requires a deopt/IC trace (`--trace-deopt` / `--trace-ic`) against their per-route context objects — a plausible but **unconfirmed** hypothesis is a V8 shape/representation threshold crossed by per-route internal structures.

**Binding publication wording for W2** *(Session 11: publication additionally gated on `repro.mjs` reproducing standalone — see Session 11 addendum; if the trigger proves to be an artifact of `bench/servers/fastify.js` construction, this claim narrows again or dies)*: the claim is *zonix is flat from 6 → 400 routes; Fastify (exact version pinned in `results.md`) loses ~30% at a cliff between 50–100 routes in our published, reproducible harness — 1.40× at 200 routes, 0.97× at 6.* Observation, not diagnosis; both numbers always shown together; harness + control + scenario spec published beside it. **Before it ships anywhere: file a minimal repro as an upstream Fastify issue.** That is both good citizenship and self-defense — if it is a bug they fix, the durable half of the claim (zonix's flatness) survives, and "found, characterized, and reported a scaling cliff in Fastify" is worth more than any ratio.

**Res surface:** every named trap has a test group. The differential oracle caught the session's real bug — Phase 3's Content-Disposition emitted `filename*` for plain ASCII, deleted quotes instead of escaping, and passed `C:\secrets\dump.pdf` whole into the header (an information-leak class, not a formatting nit); replaced with an RFC 6266/5987 module pinned by differential test against `content-disposition@0.5.4` (30 curated + 2,000 fuzz names) — hence rule 8. Cookie signing verified wire-compatible with `cookie-signature` in both directions (`timingSafeEqual`); `clearCookie` applies expiry **after** caller options so a stray `maxAge` cannot turn a clear into a renewal. Craft notes on record: character-class regexes were written wrong twice before switching to linear char scans (decision 11's ban vindicated in practice), and the CRLF test initially failed against *correct* behavior — injected header names legitimately appear inside encoded values, so the assertion must match a header *line*, never a substring. Deferrals to Phase 7 (`res.format`, ETag/freshness in `send`, `req.accepts`/`fresh`/`range`) approved — all [P7] machinery. **Phase 6 closes with its exit test: a handler copy-pasted from the Express docs, unmodified.**

### Path to First — the M-criteria (binding program)

The W-criteria established honest standing: parity where physics rules, wins where architecture differs. The M-criteria define **first place by a large margin** — every item names where the margin comes from, because margins don't come from wishing at a 3%-self-time ceiling.

**The arithmetic, one last time, so nobody relitigates it:** zonix's framework cost is ~3.1% of a hello-world request. Fastify sits at the same ceiling. Inside `node:http`, "beating Fastify by 20% on hello-world" is not hard — it is *unavailable*, to every framework, permanently. Whoever claims it is measuring wrong (this project has personally discovered three ways to measure it wrong). Massive margins therefore come from exactly four places:

- **M1 — Static serving, target ≥ 2× both competitors (structural).** Buffered ≤32KB path (+98.4% proven) + Phase 7 stack: opt-in memory cache (LRU, byte-capped, mtime-revalidated) + ETag/304. Competitors stream-and-stat per request; revalidate-from-memory is a different complexity class. **Blocked solely on the AV exclusion (Swapnil, manual, third session pending).** Adjudicated only under a passing regime preflight.
- **M2 — Routing at scale, already won (1.40× at 200 routes).** Durable form per Session 6 wording: flat 6→400 vs a ~30% cliff at 50–100, published with harness + upstream repro. Extend the sweep table to 400 in `results.md`; the pinned-version claim ships after the upstream issue is filed.
- **M3 — Footprint & cold start (the zero-dep dividend, margins of 10–100×).** New `bench/startup.mjs`: install size (bytes + file count of `node_modules`), cold `require()` time (10-run median), RSS after 10k requests — zonix vs Express vs Fastify. These are real production metrics (serverless cold starts, container images, supply-chain surface) where zero dependencies is not a philosophy but a number. Expected: install-size margin in the orders of magnitude; require-time margin large; publish all three honestly even where the margin is small.
- **M4 — The Turbo track (the only route to a massive micro-benchmark margin): a second transport, gated by a kill-spike.**
  - *Architecture:* transports become pluggable under the same zonix API — `zonix()` stays `node:http` (full compat, default forever); `zonix({ transport: "turbo" })` is a hand-rolled HTTP/1.1 server on raw `net` sockets: incremental parser, pre-built response buffers, **corked writes** (every response parsed from one data event flushes in one `write`), minimal req/res shims implementing the documented zonix surface subset.
  - *T-0 spike (one session, kill-gated):* ≤ 300 lines, GET-only, keep-alive + pipelining, request-line + terminator scan only, static response buffer. Paired same-session vs **raw `node:http`** on this rig. **Kill bar: < 1.3× raw node:http → Turbo dies, cheaply, forever, and this section records the number.** ≥ 1.3× → a design doc *before any further code*, covering: parser state machine + header limits, content-length and chunked bodies, keep-alive/slowloris timeouts, pipelining caps, malformed-input fuzz corpus, **request-smuggling suite (CL/TE conflicts hard-close the connection — non-negotiable)**, backpressure, and the compat-shim cost budget (if the shim eats the margin below 1.2×, Turbo is pointless and also dies).
  - *Stance:* Turbo ships experimental-flagged until its parser has its own fuzz + smuggling suite green; it never becomes the default; `node:http` compat remains the product. This is v3 work — nothing in M4 starts before v1.0 is on npm except the T-0 spike itself.
  - ***T-0 EXECUTED* (Aug 2026, by the tech lead, in a 1-core container — code delivered, drop into `bench/servers/spike/`).** Spike: ~75 lines, GET-only HTTP/1.1 on raw `net`, terminator-scan parsing with method check, cached Date, **corked writes**, 8KB header cap, 405/431 guards. Passed a 5-test correctness gauntlet first (single request, pipelined ×3 in one packet, byte-dribbled partial delivery, bad method → 405+close, oversize → 431). Paired interleaved vs the strongest raw `node:http` baseline: **pipelining=16 → 12.63× median (5/5 pairs, 11.99–13.51×); pipelining=1 → 1.78× median.** The decomposition is the finding: **~1.8× is pure per-request lifecycle savings** (no IncomingMessage/ServerResponse construction, no full header parse, no stream machinery); the remainder is corking — 16 responses per syscall — amplified by 1-core colocation, where every cycle the server doesn't burn becomes client capacity. **Both configurations clear the 1.3× kill bar → Turbo lives; the design doc is unlocked.** Binding caveats: container absolutes are meaningless and **12.6× is not a claimable number** (colocation-amplified); the transferable signal is the p=1 ratio; **official adjudication is the same spike re-run, paired, on the reference rig** — expect the truth between ~1.8× and the corked figure, depending on pipelining depth. The production question is unchanged and already specced: the compat shim must retain ≥ 1.2× or Turbo dies at the design-doc stage instead.
  - ***T-1 EXECUTED — TURBO KILLED* (Aug 2026).** Judged cell (p=1, C=6, sync hello, paired, five rounds, machine quiet at 3.7%): **1.362× vs raw `node:http` — bar 1.40×, FAILED; no single pair (1.29–1.39) reached it.** 1.392× vs Fastify (bar 1.30×, cleared); 1.408× vs zonix. One bar missed → death per D7 — pre-committed configuration, no re-rolls. This section records the number, as promised. **M4 is closed permanently**; the `t1/` artifacts remain as the falsification record. *Reopening clause (Session 14 ruling):* the T-1 verdict is never re-run in hope of a different number. The only door that exists: a **materially new transport design** may face the **same unchanged bars** (≥1.40× raw / ≥1.30× Fastify, shim-inclusive) via one new kill-gated spike — and only after a written mechanism claim, recorded in this file before any code, naming which specific component of the measured ~20% erosion (real parsing, HOL ordering, per-request response building) the design eliminates and why. Absent that written claim, "let's try Turbo again" is answered by this paragraph.

**The Fastify playbook, reverse-engineered — and our status against each item** (their speed is documented and public; this table is why the micro gap is noise): schema serialization via codegen → matched in effect by `createSerializer` (~1% at bench payloads, settled); find-my-way radix routing → matched and exceeded (flat 6→400 vs their cliff); monomorphic request/reply object shapes → matched (subclass fields, decision 1); precomputed hook/handler chains → matched (precomposed pipeline, +5.04%); single-pass header write → matched (writeHead batching, header self-time 3.90% → 1.79%); lazy parsing of query/headers → matched (decision 1); minimal per-request allocation → matched (zero-alloc walk, shared EMPTY, sync completion). Conclusion: **their homework is finished, which is precisely why the residual is 3% — inside noise, at the shared ceiling.** What differs between the projects now is their cliff (we hold the repro) and their dependency graph (~15 runtime deps vs 0 — M3 turns that into numbers).

*Session 8 addendum (Aug 2026 — T-0 official, Phase 6 closed, TURBO.md accepted, D7).*

**T-0 official (reference rig, quiet, 5.0–5.9% background across 24 cores):** p=16 → raw 150,848 vs turbo 1,606,115 (**10.78×**); p=1 → 84,167 vs 144,325 (**1.71×**). The p=1 prediction transferred within 4% from a 1-core container to a 24-core workstation — the instruments are now *predictive*, not merely descriptive. Load-generator validity was checked (1/2/3 client processes: raw flat ~91k, turbo saturating ~152k — both server-bound). **New finding the container could not produce: at C=1 the ratio is 1.16×, below the kill bar** — a single unpipelined connection measures round-trip latency, which both servers pay identically. **Binding README language: Turbo is a throughput engine, not a latency engine.** Accountability note, owned by the tech lead: the spike was delivered without its correctness gauntlet as a file (tests ran inline, undelivered); the session correctly rebuilt it (`gauntlet.mjs`, 5/5) before trusting any number — affirmed as standing practice: **no bench artifact ships without its correctness tests as committed files.**

**Phase 6 CLOSED.** The exit test's oracle half proved its worth within minutes: a hand-written assertion (`res.set("Content-Type","text/plain")` → bare `text/plain`) was itself wrong — Express appends `; charset=utf-8`, and so does zonix; without the wire diff, correct code would have been "fixed" to match a wrong test, the Content-Disposition failure mode exactly. Five real defects fixed: missing `res.redirect(301, url)` overload; string bodies now force `charset=utf-8` onto any Content-Type; `req.is("application/*")` returns the matched *type*, not the pattern (**the Express docs are wrong about their own behavior — upstream docs PR queued**); `res.type()` on unknown extensions falls back instead of throwing (per decision 11 and Express); `normalizeContentType` no longer accepts garbage like `a/b/c` and `-/99y` that then matched `*/*` — caught by the fuzz differential, "the one that would have shipped." `type-is@1.6.18` pinned with its own differential per rule 8. Environment correction, recorded honestly: Node 20 is no longer installed locally — **local claims are Node 22-only from here; `engines: ">=20"` stands; the version matrix becomes CI's job at Phase 9.**

**D7 — Turbo's bar is raised (binding; this answers TURBO.md's sharpest open question).** No: a marginal pass is *not* worth permanently owning a security-critical parsing surface. The cost of a hand-rolled HTTP/1.1 parser — smuggling surface, fuzz upkeep, forever-maintenance — is constant; a 1.2× margin is not: it erodes under the ±5% noise floor, under hardware generations, and under adversarial re-benching, and it sits below the threshold at which anyone migrates frameworks. New kill bars, applied at **T-1, shim-inclusive, paired, quiet machine: ≥ 1.40× vs raw `node:http` AND ≥ 1.30× vs Fastify** (sync-handler hello). Below either → Turbo dies, the number is recorded, and zonix's crown rests on M1–M3 + parity — still a winning position. At or above → the smuggling/fuzz investment is justified; Turbo remains experimental-flagged until that suite has soaked. The p=16 figure is never the judged number.

**T-1 spec, sharpened (approved):** the thinnest end-to-end path must include a *real* request-line + header parse with limits enforced (terminator-scan is spike-only), the head-of-line ordering queue in the measured path even at depth 1, and the documented zonix `res` subset the route needs. Measured paired against **three baselines** — raw `node:http`, zonix-on-`node:http`, and Fastify — under **two handler brackets**: sync-completing hello and an async echo (`setImmediate`), so the corking benefit is bracketed [async, sync] instead of assumed. Cheap decisive question first; hardening only after D7's bars are cleared.

*Session 9 addendum (Aug 2026 — T-1 executed; TURBO KILLED).*

**The kill is final and will not be relitigated.** The Fastify bar clearing (1.392×) does not resurrect Turbo — the AND condition *was* the decision. D7's asymmetry (a hand-rolled parser's security cost is constant and forever; a 1.3–1.4× margin is not) applies with full force to a result whose pairs dip to 1.29×: under the ±5% noise floor and one hardware generation, that margin rounds toward nothing while the smuggling surface stays whole. Softening a pre-committed kill bar after seeing the number would spend the exact credibility that makes every other number in this project publishable. **Turbo's death is the proof the gates are real.**

**What T-1 bought, at minimum price: the erosion number.** The spike's 1.71× fell to **1.362×** the moment the path became honest — real request-line + header parsing with every limit enforced (token method, no-ws-before-colon, 100-header/8KB-line/16KB-head caps, strict CL digits, dup-CL → 400, TE → 501), the HOL ordering queue live at depth 1, per-request response building, T-0's static-buffer cheat removed. **~20% of throughput is what `node:http`'s obligations actually cost once you rebuild them yourself.** Brackets behaved exactly as TURBO.md predicted: async-echo 1.28× vs raw; p=16 corking real but modest with honest parsing (1.65× sync / 1.55× async) — never the judged number. Had D7 left the bar at 1.2×, Turbo would have *passed* at 1.362× — and the project would now own a security-critical parser for a margin that erodes to noise. The raise was the decision that mattered. Process craft on record: `gauntlet.mjs` 16/16 as committed files **before any number was read** — including response-ordering under a slow first request and fatal-behind-in-flight — plus `smoke.mjs` across all four servers in both brackets; the tech lead's earlier delivery gap, institutionalized into practice by the session that inherited it.

**The crown after the funeral:** parity at the shared ceiling (0.97× hello, 0.99× echo); **M2 won — 1.40× at 200 routes, flat 6→400 against a ~30% cliff: the exact number Turbo needed and missed, the router already delivered**; M1 pending only on the regime preflight (structural ≥2× potential); M3 pending (orders-of-magnitude footprint margins, one session of work); two upstream contributions queued; and a falsification record most framework projects cannot show. Phase 9's README gains a planned section — **"Measured and rejected"**: Option B codegen, the `.pipe()` swap, 256KB highWaterMark, and Turbo. The honest-benchmark brand, extended to its logical end.

*Session 10 addendum (Aug 2026 — AV exclusion verified; rule 7 recalibrated; W1 unfrozen).*

**The differential proof.** Repo folder (excluded): 46,407 / 49,852 / 50,698 opens/sec at 12.3–12.8× across three runs. `%TEMP%` (deliberately not excluded): **5,096 opens/sec at 124×** — the filter-driver signature, alive and well, exactly where the exclusion doesn't reach. That is path-scoped proof the exclusion works, not an inference from one number moving. The repo's clean profile (≈48k @ ~12.5×) is ordinary Windows `CreateFile` overhead — NTFS, not Defender.

**Why the threshold moved and the Turbo bar didn't — the distinction is load-bearing.** The 50k preflight threshold was a round-number guess made before the clean ceiling was known; it landed *inside* the machine's clean noise band, producing two fails and a pass across three clean runs. **Decision bars (D7-class) are pre-committed and never move after contact with a result — that finality is what makes them mean anything. Instrument thresholds are calibrated to measured mechanism, and both regimes are now measured**: the new lines (opens < 20,000 OR ratio > 40×) sit an order of magnitude from each signal, in a gap where no honest run can flicker. The recalibration also closes BI-1's original wound properly: the check now runs pre **and** post, because the disaster that created rule 7 was a mid-run flip that a preflight alone can never catch — disagreement stamps **REGIME-FLIP** and voids the session. `bench/probe.cjs` stays in the repo as the two-second hand tool it proved to be; detector constants live in one shared module so the harness and the hand tool can never drift apart.

**W1 is unfrozen after four sessions.** The file path — buffered ≤32KB send with +98.4% paired mechanism already proven, the Phase 7 cache + 304 stack ready to build on top — is finally adjudicable under a trustworthy regime. Exit (c) and the M1 crown go back on the board where they belong.

*Session 11 addendum (Aug 2026 — the two-machines finding; M3 delivered; upstream verdicts).*

**The contradiction, stated plainly.** Session 10 verified the exclusion with a live differential in Swapnil's Git Bash: repo ~48k @ 12.5×, `%TEMP%` 5,096 @ 124×. Session 11's harness, run through Claude Code's execution context with the (old) recorded regime check, read the repo at 3,897/4,617/4,506 @ 123–163× — and system-wide (fixture 3,863, repo 4,200, `os.tmpdir()` 4,453). Both measurements are probably true: **the exclusion landed in one execution context, and the benchmarks run in another.** The Session 10 conclusion is corrected, not retracted — the differential proof was real, but it proved the wrong courtroom. W1 returns to frozen until the harness's own context reads clean. Accountability: the tech lead treated "the machine" as one thing; environment identity was an uncontrolled variable in every regime reading since BI-1. It is controlled now (fingerprint, rule 7). *(Session 12 resolution: fingerprints matched — the two "machines" were one context at two times; the exclusion had reverted between readings.)*

**Diagnosis protocol (next session, first item):** print the fingerprint from inside the harness context, then run the repo-vs-`%TEMP%` differential *in that context*. Decision tree: platform `linux` + Microsoft in `os.release()` + cwd under `/mnt/c/` → WSL bridge overhead explains everything regardless of Defender, and the fix is environmental (run the harness natively on Windows, or move the repo inside the WSL ext4 filesystem — which is also the fastest and Defender-free option); platform `win32` in both contexts → the exclusion is flaky or reverted (Defender exclusion list re-check, Tamper Protection, org policy), adjudicated by the in-session differential. Swapnil's parallel two-second check: re-run `bench/probe.cjs` in Git Bash to confirm the interactive context is still clean.

**M3 — delivered, and the honest table stands:** install **116 KB vs 2.21 MB (Express) vs 7.38 MB (Fastify) — 65×**; files **5 vs 618 vs 2,033 — 407×**; packages **1 vs 68 vs 56**; cold import 16.2ms vs 77.5/68.8ms; RSS after 10k requests 47.1 vs 100.8 vs **56.3 MB — Fastify only 1.20×, stated plainly per D2's honesty standard**. Bonus finding with real-world teeth: **first import after install — 21.6ms vs 1,240/1,487ms** — on AV-laden machines (CI runners, corporate laptops, scanned serverless), the file-count margin becomes a 57–69× wall-clock cold-start wall. Publication annotation rule: install/files/packages are static facts, publishable unconditionally; import-time and RSS numbers carry their regime fingerprint, since the degraded context inflates per-file costs and thereby the ratios.

**Upstream verdicts.** Express docs PR: **approved for filing** — verified against `type-is` 1.6.18 *and* 2.1.0 plus the wire test; the framing (docs prose already correct, only the two wildcard examples contradict it) is exactly right; 4-line docs-only diff; Swapnil files it from his account. Fastify cliff issue: **correctly held by its own readiness definition.** The recorded harness reproduces for the third consistent session (93,424 → 70,896, −24%), but a from-scratch minimal server is flat-to-inverted, and a paired swap pins the trigger to something inside `bench/servers/fastify.js`; three candidates falsified one at a time (handler style, fixed-route mix, shared options object); isolation stopped when the machine wobbled ~40% intra-config on socket benches with the CPU preflight green — a preflight blind spot now in the standing rules, plausibly the same context mystery. Consequence accepted without flinching: **W2's publication is gated on the standalone repro**; if the cliff is an artifact of our own server construction, the claim narrows again or dies — the control did its job once, and it can do it twice.

*Session 12 addendum (Aug 2026 — diagnosis decisive-and-forked; detector shipped; the Fastify sign-flip; D8).*

**Diagnosis.** Fingerprint from inside the harness: native win32 10.0.26200, `C:\Program Files\nodejs\node.exe` — the WSL/bridge hypothesis is dead on arrival. Differential in that context: repo 3.8–4.3k @ 74–166×, `%TEMP%` 4.7k @ 67–72× — **no differential; nothing is excluded from where the benchmarks run**, sandbox on or off. With Tamper Protection ON and a 13:36 reboot in the timeline, the remaining fork is clean: Swapnil re-runs `probe.cjs` interactively — still ~48k means the exclusion is process-scoped (admin `fltmc`/exclusion-list inspection later); now ~4k means Tamper Protection or the reboot reverted it and "two machines" were two *times*. Either way, per D8 the answer no longer gates the program. *(Resolved same day: the interactive context re-read 4,339 @ 142.4× repo / 4,762 @ 128.2× `%TEMP%` with a matching fingerprint — one context, two times; the exclusion reverted after the 13:36 reboot, and the admin-only exclusion list points to managed Defender policy, so manual exclusions will keep evaporating on this host. Classified UNSTABLE; the container is the courtroom, exactly as D8 decided one session before we learned why it had to be.)*

**Detector port (`583d72c`).** `bench/regime-constants.cjs` is the single copy (degraded = opens < 20,000/sec OR ratio > 40×, both mid-gap); `regime.mjs` and `probe.cjs` import it; every reading carries its fingerprint; all three harnesses check pre and post with REGIME-FLIP voiding — exercised live, no flip.

**The Fastify finding changed shape, twice, and the second change is the real one.** Isolation by *stripping the reproducing server* (instead of building up a minimal one) found that the cliff never disappears: verbatim, no-files, scale-only, true-minimal, callback-style — 16/16 round-pairs, and the minimal repro is nothing but `Fastify({logger:false})` plus N param routes. Every "trigger ingredient" from Session 11 was an artifact of the pre-reboot sick machine. Then the twist: later the same afternoon, the same finalized repro read the effect **inverted** (+14–27%), order-reversal controlled — not positional. Cliff windows correlate with fast-machine bands (where all three recorded cliff sessions sat); inversions with slow bands. Meanwhile **zonix, measured in the same states, both orders: 0.970 / 1.010 — flat through everything.** Consequences, faced squarely: zonix's half of W2 (flatness) is now *stronger* — it survived machine states that flip Fastify's sign; Fastify's half is **requalified, not filable** on single-machine sign-flipping evidence — `ISSUE.md`, `repro.mjs`'s own header, and rule 9 now say so. The honest possibility on the table: what three sessions recorded as "Fastify's cliff" may be an interaction between Fastify and *this machine's* state bands. A second environment decides.

**D8 — the pinned bench container (binding).** A Docker image becomes the **official environment for file scenarios and all cross-framework claims**: pinned Node 22 base, **repo COPIED into the image or a named volume — never bind-mounted from `C:\`** (Docker Desktop's file-sharing bridge would recreate degraded-regime numbers for a different reason and the whole lesson would repeat), `--cpus` pinned for consistency, regime probe + fingerprint on entry (expected: ext4-native, no filter driver — clean by construction), BUSY-MACHINE discipline still applies because the VM shares the physical cores with the host. What this buys: (1) **W1/exit-(c) adjudication immediately** — six sessions frozen, unfrozen by changing courtrooms instead of winning the Defender argument; (2) the second environment rule 9 demands for the Fastify sign question; (3) reproducibility as a published feature — `docker run` and anyone can re-derive the table, which no competitor's benchmark page offers. Limits, stated: same physical hardware (thermals/power shared), so the strongest second-machine evidence remains a CI runner — which Phase 9 was always going to add; host-established socket results (hello/param/chain, T-0/T-1) remain valid as recorded. The host Defender mystery drops to a dev-comfort item (first-import speed, npm installs) — worth fixing, no longer capable of freezing anything.

*Session 13 addendum (Aug 2026 — container live; exit (c) MET; the bimodal finding; consolidated scorecard).*

**Container (D8 delivered, `5b49714`/`44b0f86`):** `bench/Dockerfile` pinned to the host's exact Node (22.20.0-bookworm-slim), repo copied never mounted, `container.mjs` with host BUSY-MACHINE preflight, `--cpus=8`, regime probe + fingerprint on entry — **582–620k opens/sec @ 5.6× every run.** Six sessions of frozen file work, unfrozen by changing courtrooms.

**Exit (c) — MET.** file-1kb, three frameworks, rotating order, five rounds, clean pre+post, no flip: zonix 12,370 (3.8% spread) / express 7,117 (3.1%) / fastify 8,647 (6.8%) → **1.74× Express, 1.43× Fastify** via the F1 buffered-send mechanism proven paired on the host. M1's full target (≥2× both) awaits the Phase 7 cache + 304 stack on top.

**The Fastify effect, resolved: bimodal, not a cliff.** Two windows, zonix control both orders each: window 1 flat (0.998); window 2 read 0.665 — because two 6-route processes hit ~165k while every other process, both table sizes, sat at ~105k; a 6-round follow-up read 12/12 at ~105k. **200-route processes: 0/12 ever in fast mode. There is no per-request cost that grows with the table — there is a fast mode small tables sometimes reach and large tables were never observed to reach.** This explains every recorded cliff/flat/inversion, including the nextTick profile signature (fast-mode-6 vs common-mode-200). zonix in the same states: 141–150k, 0.97–1.01, **no modes**. Ratified: W2's claim retires "cliff" and stands on two environments as *"zonix is flat and unimodal 6→400 routes; Fastify is bimodal per-process, and 200-route tables were never observed in its fast mode"*; ISSUE.md reframed accordingly; **ROUNDS=20 mode-frequency sampling before filing.** Predictability enters the scorecard as a parameter: capacity planning against a deterministic ~145k beats a 105k-or-165k lottery.

### Consolidated scorecard (everything measured, Sessions 1–13)

**Throughput** *(host = reference rig, same-session interleaved; container = D8, ratios only)*
| Scenario | zonix | vs Express | vs Fastify | Env |
|---|---|---|---|---|
| hello | 142,963 | 5.49× | 0.97× | host |
| routes-6-param | 117,254 | — | 0.97× | host |
| routes-200-param | 115,994 | 6.05× | 1.40× | host |
| 10-middleware chain | 139,994 | 5.53×* | 0.96× | host (*older baseline) |
| 404 | 137,459 | — | 0.99× | host |
| post-json-echo | 62,134 | 3.74× | 0.99× | host |
| file-1kb | 12,370 | **1.74×** | **1.43×** | container |
| routing determinism | 0.97–1.01, no modes | — | Fastify bimodal (105k/165k) | both |

**Footprint (M3, static facts unconditional; timing regime-annotated)**
| Parameter | zonix | Express | Fastify | Margin |
|---|---|---|---|---|
| Install size | 116 KB | 2.21 MB | 7.38 MB | 19× / 65× |
| Files | 5 | 618 | 2,033 | 124× / 407× |
| Packages | 1 | 68 | 56 | 68 / 56 : 1 |
| Cold import | 16.2 ms | 77.5 ms | 68.8 ms | 4.8× / 4.2× |
| First import (AV host) | 21.6 ms | 1,240 ms | 1,487 ms | 57× / 69× |
| RSS @ 10k reqs | 47.1 MB | 100.8 MB | 56.3 MB | 2.14× / 1.20× |

**Engineering parameters:** runtime deps **0**; 428 tests green (Node 22; matrix → CI at P9); dispatch self-time ~1.16% (gate ≤1.5%); regression gate ≤2%/phase passing throughout; oracle differentials pinned (`content-disposition@0.5.4`, `type-is@1.6.18`+`@2.1.0`, `cookie-signature` wire-verified, `negotiator` next); fuzz corpora (serializer 10k byte-parity, content-disposition 2,000 names, security suites: CRLF/traversal/pollution/disconnect); one falsification record (Turbo, T-1) and one "measured and rejected" ledger — assets no competitor page has.

**Capability today (Phases 0–6 shipped):** radix router (flat, unimodal, 6→400), Connect-compatible middleware with Express `next(err)`, the Express req/res surface through Phase 6 (D6: Express-5 `req.host`), signed cookies wire-compatible with `cookie-signature`, CORS, buffered static ≤32KB, JSON body with byte limits, `createSerializer`, central error dispatch with disconnect tagging — exit-tested against a copy-pasted Express-docs handler. **Deferred by design:** accepts/format/fresh/range/ETag/compression/static-cache → P7; Router mounting/4-arity/urlencoded-raw-text/extended query → P8; npm/CI/README → P9.

*Session 15 addendum (Aug 2026 — the Fastify source audit; parity becomes a fact, not a claim).*

Fourteen hot-path techniques from `fastify@5.12.1` + `find-my-way@9.8.0`, each dispositioned: single-pass headers, precomputed chains, sync completion, monomorphic shapes — MATCHED (with zonix *ahead* on wrappers-per-request: zero vs two, plus lazy query and the static-route Map Fastify lacks); `end(payload,null,null)` — obsolete since V8 8.9; codegen matchers and per-route param literals — the halves decision 11 bans, with the legal halves either measured below resolution (#8: 46 ns ceiling ≈ 0.4% on the deepest param path — declined at ~80 lines of complexity) or trivial (#7: 3 ns — declined); server timeout defaults — different by design, zonix keeps the slowloris posture (#12, no throughput mechanism). **The one mechanism Fastify had that zonix lacked and decision 11 allows — #9, params-object shape — is implemented, guarded, tested (463/463), and kept**: microbench unambiguous (build cost halved, read 5.3→3.8 ns), paired e2e +0.47% median 6/7 positive — exactly the predicted sub-noise magnitude, kept on the deleted-allocation precedent of item 4. The distinction that must never be reverted: **params keys come from developer route patterns (plain object + registration-time proto-key rejection is safe); query keys come from attackers (null-prototype stays, per decision 11).** Baseline frozen pre-edit (`snapshot.mjs`), hello gate PASS at −0.15% median. **Verdict, now quotable: zonix's parity with Fastify is source-audited — every technique in their hot path is matched, obsolete, banned by policy with measured ceilings, or a place where zonix is ahead. The residual is the shared `node:http` ceiling, and both frameworks are pressed against it.**

**MH-1 — the mode hunt (optional, ONE bounded session, only after the matrix).** The question, stated fairly: is Fastify's ~165k fast mode a *mechanism* zonix could adopt deterministically, or a *mood* — V8 blessing an entire process, `node:http` internals included? Priors on record: a ~57% mode gap cannot live inside ~3% framework self-time, so the blessing spans the shared path, not their code alone; and zonix has never produced a high-mode outlier in any sampled window (141–150k, no modes, every order) — ~145k looks *converged*, not unlucky. The expected-value arithmetic also goes on record: at observed frequencies (2/12 fast), Fastify's small-table expectation ≈ 115k vs zonix's deterministic ~145k — **zonix already beats the lottery's average by ~26%; the jackpot only pays +14% and the losing ticket costs −28%.** Method: `--trace-deopt` / `--trace-ic` + CPU profiles on three processes — Fastify fast-mode, Fastify common-mode, zonix — and *name* the differing optimization states at the shared call sites. **Kill criteria, pre-committed:** if the blessing is inseparable from their per-route wrapper pattern (adopting it imports the lottery), record and close — **determinism is a scorecard feature and is not for sale**. If a deterministically adoptable call-pattern emerges (an argument shape, a site we can hold monomorphic), it enters the standard rule-5 pipeline as an ordinary candidate, like item #9 did. Either outcome strengthens ISSUE.md with a named mechanism before filing. *(Session 16 scope addition: MH-1 also hunts the **harness suppressor** — strip-diff `bench/servers/fastify.js`'s 200-route configuration against the minimal repro, 20-round mode sampling per variant, until the ingredient that yields 0/13-fast is named. Finding it may be the same thing as finding the V8 mechanism.)*

*Session 16 addendum (Aug 2026 — post-audit matrix + cpeak; the table-size withdrawal; the echo gift).*

**The matrix (container-official; supersedes the Session-13 throughput table for container claims — host rows remain valid as host-era records):** hello 161,984 / 28,030 / 172,480 / 136,090 (z/e 5.78×, z/f 0.94×, z/c 1.19×); routes-6 147,712 → 5.65× / 0.91× / 1.20×; routes-200 147,187 / 22,382 / 107,386 / 123,693 → 6.58× / **1.37×** / 1.19×; chain 151,475 → 5.62× / 0.91× / 1.53×; 404 150,323 → 6.03× / 0.98× / 1.11×; post-json-echo 44,432 / 14,528 / 47,379 / **76,134** → 3.06× / 0.94× / **0.58×**; file-1kb 12,458 / 7,099 / 8,711 / 6,773 → **1.76× / 1.43× / 1.84×**. Smoke: byte-identical responses across all four before any number (cpeak omits `; charset=utf-8` — recorded). Regime clean pre+post, 404==100% asserted, spread breaches logged as single-round dips. Post-audit ratios unchanged within noise vs pre-audit — exactly as the audit's sub-noise measurements predicted.

**W2 wording, revised (binding — third revision, each one narrower and harder to attack):** Lead with what is unconditionally true: **zonix is unimodal and deterministic in every scenario, configuration, and environment measured** (141–165k container band; flat controls 0.97–1.01 throughout). Fastify's per-process throughput is a lottery whose fast-mode frequency is **configuration-sensitive**: ~45% in minimal repros at *both* 6 and 200 routes (8/20, 9/20), 16/16 in our harness's small-table configs, **0/13 in our harness's 200-route config — suppressor unidentified (MH-1)**. Ratios versus Fastify at 200 routes are therefore configuration-qualified: **1.37× in the published harness; ≈1.12× against the minimal-repro expected value** (EV ≈ 0.575·107k + 0.425·165k ≈ 132k vs zonix's deterministic 147k); never below parity — and with zero variance on our side. The earlier "never observed in fast mode at 200 routes" is withdrawn on the record. ISSUE.md does not file until MH-1 names a mechanism.

**ECHO-1 (spec, next session — the first decisive zonix loss, and the best kind: adjudicable and mechanical).** cpeak@2.9.2 wins post-json-echo at 1.71× over zonix, 1.61× over Fastify — the Fastify audit missed it because it audited the wrong framework. Method: flamegraph zonix's echo path; read cpeak's `parseJSON` source; diff table (technique | cpeak | zonix | expected effect) in `results.md`; **explicitly determine whether cpeak's speed depends on skipped guards** (byte limit, content-type gate, charset handling). Implement legal mechanisms only — likely candidates: a single-chunk fast path (bench-sized bodies arrive in one data event), copy/concat elimination, parse-from-buffer — **with the 413 byte-exact limit, content-type gate, and charset handling fully intact**; equivalence and limit-boundary tests required (rule 3). Adjudication: plain paired e2e (the gap is 10× the noise floor), all four frameworks re-run for the record, ≤2% gate on every other scenario. If cpeak's advantage turns out to be a skipped guard, we adopt the mechanism and keep the guard — and the diff table says so plainly.

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
7. **Regime & load checks — pre AND post (recalibrated Session 10).** Around any file scenario — before **and after**, because BI-1's original disaster was a *mid-run* flip and a preflight alone was only ever half a check — the harness measures raw `open()`/close throughput *and* reads-on-an-open-fd on the bench fixture, recording both in `results.md`. **Degraded = opens < 20,000/sec OR open-vs-fd-read ratio > 40×.** These lines sit mid-gap between two *measured* regimes on the reference rig — clean ≈ 48k @ ~12.5× (plain NTFS `CreateFile` cost), filter-driver ≈ 5k @ ~124× — an order of magnitude from each signal, unlike the original 50k round-number guess that sat on the clean noise band and flickered across consecutive clean runs. Pre/post disagreement stamps the session **REGIME-FLIP** and voids it. Both detector constants live in ONE shared module imported by `regime.mjs` and `probe.cjs` — two copies of a threshold is how they drift apart. **Every regime reading records its execution-context fingerprint** — `process.platform`, `os.release()`, `process.cwd()`, `os.tmpdir()`, `process.execPath` — because Session 11 proved "the machine" can be two machines: an interactive shell and the harness's context can sit in different regimes simultaneously, and a reading without its fingerprint is unattributable. Separately, before **every** scenario the harness samples system-wide CPU utilization and stamps **BUSY-MACHINE** when background load is present — a session-5 phantom (−44% on hello, Express −40%, Fastify untouched because it benched last) came from background agents, and a spin-loop probe was correctly rejected because one thread on a 24-core box grabs an idle core and reports all-clear. Below 50,000 opens/sec the machine is in a degraded regime (filesystem filter driver / AV interference): file scenarios still run but are stamped **DEGRADED-REGIME**, and no cross-framework or absolute claim may be built on them. Discovered via BI-1: a filter driver throttled `open()` system-wide to ~3.4–3.9k/sec (~260µs each) while reads on an open fd ran 170× faster — every framework pins at that ceiling, and a mid-run regime flip charges the change to whichever framework benches later.
8. **Oracle differential tests are mandatory.** Every module that inlines a third-party equivalent (structure rule 2) ships a differential test against the pinned original as a devDependency — curated corpus plus fuzz, byte-level comparison where the wire format matters. Reason: the Phase 3 Content-Disposition implementation passed its own tests while being wrong on 14 of 15 reference filenames — including emitting a raw filesystem path into a response header. Your own tests encode your own misunderstanding; the oracle doesn't.
9. **Controls and second environments for competitor claims.** Any table-size or scaling claim about a competitor carries a **zonix flat-control measured in the same run** — a competitor moving while zonix moves too is a machine story, not a framework story. Any claim whose *sign* has ever varied with machine state is unpublishable from a single machine: it needs a second environment (the pinned bench container, a CI runner, or genuinely different hardware) reproducing sign and rough magnitude. Session 12's discovery forced this: Fastify's table-size effect flipped from −24% to +14–27% across machine-state bands on the same rig, same afternoon, same finalized repro — while zonix read 0.970/1.010 through everything.

## Non-goals (all versions — do not build, even if tempting)

Every exclusion here has a reason, and the reasons fall into three buckets: **(a)** the platform or ecosystem already owns it better, **(b)** it is a permanent security surface disproportionate to its value — a lesson this project has now paid for twice (Content-Disposition, Turbo) — or **(c)** it is trivially available through the Connect-compat middleware escape hatch, so bundling it would only force an opinion and a cost on people who didn't ask. Item by item:

- **HTTP/2** — (a): a different module (`node:http2`) with different semantics (streams, pseudo-headers, push); in real deployments multiplexing terminates at the reverse proxy anyway, and supporting both doubles the transport surface of a framework built on `IncomingMessage`/`ServerResponse`.
- **WebSockets** — (a)+(c): a different protocol after the upgrade handshake — framing, heartbeats, its own backpressure story. That's a sibling library's job (`ws`), and the escape hatch already exists: `app.server` exposes the raw server for `upgrade` listeners.
- **Multipart/file uploads** — (b): a busboy-class *streaming* parser — boundary scans across chunk splits, part quotas, zip-bomb/DoS surface. v2 candidate at best; the project's scar tissue on hand-rolled parsers is documented.
- **Clustering** — (a): `node:cluster`, PM2, and containers own multi-core; a framework wrapper adds opinion, not value. Orthogonal layer.
- **Template engine** — (a)+(b): mature engines are one `npm i` away for users; owning one means owning an HTML-escaping/XSS surface forever. zonix is JSON-API-first; `send`/`sendFile` cover HTML output.
- **Auth/session helpers** — (b)+(c): security-critical, opinion-heavy (JWT vs session vs OAuth), and the ecosystem already plugs in via Connect compat (passport-class middleware). cpeak bundles PBKDF2 auth; we deliberately do not own crypto decisions users disagree about.
- **Request logging** — (c): ten lines of userland middleware, or pino/morgan through the compat layer. Bundling one violates pay-for-what-you-use (performance rule 1).
- **Schema validation** — (b)+decision 11: ajv-class validation is codegen territory (banned), and hand-rolling JSON Schema is a multi-year project. `createSerializer` deliberately does serialization only; zod/ajv plug in as middleware.
- **JSONP** — legacy, XSS-adjacent, obsolete since CORS; Express keeps it only for back-compat. Carrying it adds a security wart for zero modern users.
- **`app.param()`** — (c): Express's own docs steer away from it; it complicates router mounting order for something that is a three-line middleware.
- **Regex route paths** — (b)+decision 11: path-to-regexp is precisely where Express's 2024 ReDoS CVE lived. User-supplied regexes in the hot path violate the linear-parsing ban; radix + params + tail wildcard covers real route shapes, and exotic matching falls through to middleware.

(Ranges, ETag/caching and compression are **not** non-goals anymore — they're scheduled in Phase 7. During Phases 0–5 they stay out.) List the rest in README as roadmap; keep them out of lib/.

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
- **`maxParamLength` guard** (Fastify source audit, item #14): cap the decoded length of any single param segment (configurable, sane default) → reject oversized with 414 — a DoS guard on the router path, not a perf item; scheduled with the Phase 7/8 router work.
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


---

*Session 17 addendum (Aug 2026 — ECHO-1: the cpeak gap closed, one mechanism, every guard kept).*

**Verdict: 0.58× → 1.08× vs cpeak; 0.94× → 1.78× vs Fastify; 3.06× → 5.66× vs Express** (container, same session, four frameworks, rotating order, regime clean pre+post, smoke OK). Echo went from zonix's only decisive loss to its largest lead over Fastify.

**The flamegraph named it before any code moved:** `for await (const chunk of req)` — createAsyncIterator, eos, async_hooks bind/bound, runMicrotasks, processTicksAndRejections, nextTick, GC 9.6% (vs 2.6% on hello). An iterator, an end-of-stream watcher, an AsyncResource binding, and a promise+microtask **per chunk, every request**. cpeak reads with plain `data`/`end` listeners — and its speed does NOT depend on skipped guards: its byte limit and content-type gate are real; what it lacks (BOM handling, exact gate) costs nothing measurable.

**Latent defect found and fixed by the rewrite:** the old `for await` throw on overflow destroyed the socket — a chunked-body overflow got a TCP reset instead of a 413. New wire behavior (normative, decision 13): mid-stream overflow → **413 + Connection: close**, delivered.

**Implemented:** listener-based read in `lib/body/json.ts` — byte-exact limit per chunk, single-chunk decode without concat, charCode BOM check, stream errors and mid-body disconnects reaching dispatch with the same tagging. NOT adopted from cpeak: looser prefix gate, dropped BOM handling, dropped Content-Length pre-check. Equivalence suite (`test/body/json-equivalence.test.ts`): one-write vs dribbled (split inside a multi-byte char) vs chunked → byte-identical; BOM whole vs split; chunked at limit → 200, one byte over → 413 received; dribbled overflow → 413 not reset; disconnect mid-body → `clientDisconnect: true`, tripwire clean. **468/468.**

**Adjudication:** host paired A/B vs frozen baseline: echo **+40.90% median, 7/7 pairs** (+37.3..+47.6%). Gates all inside ≤2% (hello −0.14%, param noise both ways on a 9-pair re-run — no body on that path, chain −0.60%, 404 −0.55%, file-1kb +0.05% paired-only). Container record (8 rounds): echo zonix 82,912 / express 14,651 / fastify 46,563 / cpeak 77,050; zonix per-round 77–87k vs cpeak 57–80k (cpeak's 29% spread = two low rounds — their variance, our band tight). All other scenarios unchanged within noise. Kept: the listener read. Declined/reverted: nothing — the profile named one mechanism and it was the whole gap.


---

*Session 18 addendum (Aug 2026 — MH-1: verdict MOOD; the mode located to one frame; the suppressor named).*

**Where the mode lives — one frame.** Every shared `node:http` site reached TurboFan in fast, common, and zonix processes alike; deopts identical in kind (31/29/39, warmup-class); nothing re-deopts under load. The entire self-time diff ≥0.5pp: `process.nextTick`'s own body — **0.36% (fast) / 10.25% (common) / 0.62% (zonix)** — with the fast process spending the recovered ~10% on writev/idle, i.e. on requests. Same tier, no bailout, **~28× more per call**: an IC/feedback state inside nextTick that `--trace-opt`/`--trace-deopt` cannot see. Session 6's 1%→22% signature reproduced in the second environment with the tier/deopt question answered. zonix reads 0.5–0.6% there in every process ever profiled — deterministically on the fast side of the state.

**The suppressor — table size × routes touched.** Strip-diff at 200 routes, 20 fresh processes per variant: every single-path variant 2–4/20 fast (no fixed route implicated; the "0/13 ingredient" was the matrix's cycling traffic); both ten-path variants 0/20. Controls: 6 routes → 20/20 fast at 1, 2, or all 6 paths (diversity alone isn't it); 200 routes → 8/20 / 2/20 / 0/20 at 1 / 2 / 10 paths. Availability is additionally per-session (this session 6-route offered only fast, 14/14; Session 14 offered 0/20). zonix in every state: 147–154k, no modes.

**Kill criteria: MOOD — recorded and closed, nothing to adopt.** Process-level state inside Node core, gated by Fastify's table size, routes touched, and session — inseparable from their per-route pattern exactly as pre-committed. No call shape to hold monomorphic: zonix already sits on the fast side deterministically. Practical consequence, favorable: under traffic touching several routes of a real table — the realistic condition — Fastify's fast mode was **0/40 this session and 0/13 across matrices (0/53 total observed)**; zonix's deterministic ~147k vs their ~107k common mode (**1.37×**) is what workloads see. The minimal repro's ~45% fast rate was a single-path artifact. ISSUE.md rewritten as a discussion-class report with `modes.mjs`/`suppressor.mjs` attached; the exact IC is a one-hour `--log-ic` job if the thread wants it. Filing decision → tech lead: **FILE** (Swapnil's account, his wording final; `--log-ic` as optional follow-up, not a blocker).


---

*Session 19 addendum (Aug 2026 — Phase 7 s1: fresh + range, oracle-first; a state-drift correction).*

**Correction synced from the repo:** negotiator work (pin `negotiator@0.6.3`, `lib/negotiation/`, `req.accepts` family + `res.format` with Express wire-diff) was already complete in the repo's earlier commit `68bb692` — the tech lead's lean CLAUDE.md still listed it as pending. The session did the right thing twice: **verified in place (16/16) instead of rebuilding**, and flagged the drift plainly. Ground truth is the repo + HANDOFF; the lean spec is corrected.

**Delivered this session — the deferred P6 pair, same oracle-first shape:** `fresh@0.5.2` + `range-parser@1.2.1` pinned (Express 4.22.2's exact resolutions). `lib/http/fresh.ts` preserves the oracle's acceptance to the byte — 0x20-only trimming in token lists (tabs are token bytes), weak/strong ETag cross-matching, `Date.parse`, and the deliberate landmine: `If-None-Match: *` is unconditional (fresh even with no validator) — inherited Express behavior, preserved for wire-compat, to be documented as *chosen* in the compat table. Its one regex became a comma-split (decision 11); `isWhitespace` exported from `negotiation/index.ts` so `http/` imports an entry point, not a deep path (structure rule 1). `lib/http/range.ts`: `-2 | -1 | Ranges` with `.type`, `parseInt` semantics, `combine` verbatim. **Tests before wiring:** 1,792 + 324 fresh combinations, 320 range cases, all oracle-compared (6/6); 10k-input fuzz per parser, byte parity, linear-time, 3 seeds (3/3). Wired `req.fresh`/`req.stale` (GET/HEAD, 2xx/304, validators-so-far) and `req.range(size,{combine})`. **One hot-path change** — `ZonixRequest.attachResponse` pointer (Node links only `res.req`) — gate-verified invisible: paired hello +0.38% median (−1.0..+0.9), ≤2% PASS. Docs corpus +17 requests wire-identical to Express. **494/494.**


---

*Session 20 addendum (Aug 2026 — Phase 7 s2: ETag + 304s; the HEAD reversal).*

**Oracle first:** `etag@1.8.1` pinned exact (Express 4.22.2's resolution, what `send` uses for files). `lib/http/etag.ts` — `entityTag` (`"<len hex>-<sha1 base64 27>"`, fixed empty tag), `statTag` (`"<size hex>-<mtime hex>"`), `computeEtag` with the oracle's dispatch (stat-shaped → weak by default, same `TypeError`s), `compileEtag`. Differential + 10k-entity / 2k-stat fuzz, byte parity — 4/4 across three seeds, before any wiring.

**304s wired — Express's order, zonix's default:** app option `etag: false | true | "weak" | "strong" | fn`, **off by default (rule 4)**, route-level `etag({mode})` middleware overriding per route. Freshness lives inside `send` (as in Express): tag generated when enabled and unset; conditional headers evaluated via `req.fresh` → 304 with `Content-Type`/`Content-Length`/`Transfer-Encoding` dropped, validators kept; handler-set ETags get their 304 without asking. `sendFile`/`serveStatic`: `Last-Modified` always, weak stat tag when on, and a fresh conditional GET answered **304 before reading a byte** — the mechanism the static cache and M1 sit on. Express wire-diff: generated tags **byte-identical**, 304 decisions identical, tags round-trip across servers; +11 docs-corpus requests. Raw-socket matrix covers off/app/route, weak/strong cross-matches, lists, `If-None-Match: *` with ETags off, POST-never, HEAD, stat-tag and date paths, handler-set tags.

**The wire-diff's real defect — and a decision reversal, ratified:** `HEAD /json` returned 404; Express and Fastify serve `app.get` routes for HEAD, the one-tree-per-method router didn't. v1 had *deliberately* declined the fallback ("README roadmap rather than silently added"). The oracle evidence supersedes that stance: `Router.find` now falls back HEAD → GET, **explicit HEAD routes win, unknown paths stay 404, zero cost elsewhere**; three router tests. This is how a locked stance is allowed to change — evidence, recorded, tested — as opposed to hope. Decision 2 updated.

**Gates:** 521/521 (was 494); all oracle suites green; paired hello vs frozen `c881824`: 88,224 → 88,800, **+0.29% median** (−0.4..+1.3) — PASS. Deferred deliberately: single-range 206 lands next session *together with* `Accept-Ranges: bytes` on `sendFile`, so the header ships with its implementation and wire tests rather than as a promise.


---

*Session 21 addendum (Aug 2026 — Phase 7 s3: 206 + Accept-Ranges + compression()).*

**Ranges in `send@0.19.2`'s exact order:** `preconditionFailed` (If-Match / If-Unmodified-Since → 412) and `rangeFresh` (If-Range by tag or date) differentially tested against `send`'s own methods (1,152 + 240 combinations); `contentRange`/`isBytesRange`. Full order on `sendFile`/`serveStatic`: validators → `Accept-Ranges: bytes` → 412 → **304 beats any Range** → `parseRange({combine:true})` with the If-Range gate → 416 + `Content-Range: bytes */size` → 206 + slice (buffered AND streamed paths; HEAD gets 206 headers, no body) → 200 full for invalid/multipart. Wire-diff 21 probes × 2 files (100 B and 40 KB — straddling the buffered threshold): status, headers, body identical. **The oracle corrected the spec's own words:** `bytes=` and `bytes=a-b` parse to nothing satisfiable and Express answers **416**, not the 200 the plan expected — "malformed → 200" is refined to *unparseable → 200; well-formed-but-unsatisfiable → 416*. Decision 10 updated.

**compression():** `compression@1.8.1` pinned plus its nested `negotiator@0.6.4` (equal-q tie-break preserved version-exact; app-level accepts stays on 0.6.3 — both documented) and `compressible` — whose differential **caught two missing MIME-map entries** (`application/toml`, `image/vnd.adobe.photoshop`): rule 8's third module, third catch. Design is pay-for-what-you-use as an exemplar: the middleware installs a *plan*; `send`/`json`/`sendFile` consult it only when present. In-memory bodies compress **off the event loop and keep `Content-Length`**; streamed files go through a zlib transform, chunked. Package decision order preserved (type → no-transform → filter → Vary → threshold → existing encoding → HEAD → negotiate `br,gzip,deflate` preferring `br,gzip`); skip-if-no-benefit; **ETags computed on the raw body so 304s keep working; 206 is never compressed.** Wire tests: 14 Accept-Encoding permutations decode-and-compare + threshold/no-transform/no-benefit/HEAD/304-interplay/range-untouched; Express+compression wire-diff 11 headers × 7 routes identical.

**Gates:** 552/552 (was 521); all oracles green; paired hello −0.28% median (−2.2..+1.0) PASS; paired file-1kb after the range change **+0.00%** (±4.5%, host paired-only) — the range machinery costs the file hot path nothing.


---

*Session 22 addendum (Aug 2026 — Phase 7 s4: the static memory cache; build complete).*

**Design as locked:** `FileCache(maxBytes)` — insertion-order Map as LRU (`get` = delete + re-insert), evict-oldest until fit, refuse anything larger than the cap outright, body-bytes accounting; `isCurrent` = `mtimeMs` + `size`. `sendFile` split into resolve + `#sendEntity` (validators → 412 → 304 → Range/416/206 → compression → bytes); internal `sendCached` runs the identical logic over in-memory bytes with the precomputed stat tag — **one `stat()` per hit, zero disk reads**. Race guard: a file whose size differs from its stat by read time is served but not cached. Uncached path untouched.

**Tests (20):** the hit is *proven positively* — a same-mtime same-size rewrite still serves the old bytes; mtime/size change rereads byte-exact with Last-Modified following; cap boundaries (exactly-cap fits; one byte over refused, evicting nothing; replace re-accounts); 304-from-cache by tag and date; 206-slice-from-cache with 304-beats-it and 416; gzip/br/deflate on cached bytes, ETag on raw, 206 never compressed; HEAD; directory index; 404 fallthrough; disconnect mid-cached-send (8 MB body, killed at 64 KB — all `clientDisconnect`, tripwire clean, next request served). **Equivalence (rule 3): 36 probes × 5 paths, on miss AND hit — status, headers (minus Date), body identical**; one documented framing difference (>32 KB compressible: chunked streamed vs Content-Length cached; decoded bodies compared).

**Gates:** 572/572; oracles green; paired hello −0.09% PASS. Paired file-1kb on the *uncached* path (the refactor): **+4.99%, 5/5 positive — reported, not claimed** (host DEGRADED-REGIME pre+post, no flip; at the noise floor; the container decides). HANDOFF self-trimmed to the 30-line rule (`5b3c992`). Prerequisite left for M1: a cache-on env knob in `bench/servers/zonix.js`, byte-smoked before benching.


---

*Session 23 addendum (Aug 2026 — M1 ADJUDICATED: MET. Phase 7 CLOSED.)*

**Prerequisite passed before any number:** `ZONIX_STATIC_CACHE=1` knob; `smoke-cache.mjs` 32/32 wire-identical (cache-on cold AND warm vs default — status, every header but Date, body), on host and in-container; all five servers SMOKE OK. **Run:** D8, `--cpus=8 --abort-busy`, host 4.9% quiet, regime CLEAN pre (274,765 opens/s @ 10.2×) and post (234,120 @ 15.1×), no flip, rotating order, 5 rounds + warmup, every spread ≤ 4.0%, Fastify unimodal.

**file-1kb:** zonix 11,337 · **zonix-cache 28,603** · express 7,093 · fastify 8,839 · cpeak 6,737. **Cache row: 4.03× Express, 3.24× Fastify, 4.25× cpeak** (2.52× own default) — **≥2× MET against every member of the field, published opt-in-labeled.** Default row: 1.60× / 1.28× / 1.68×. file-1mb (informational): cache 1.36× / 1.15× / 1.26× — the memcpy dominates at 1 MB, as expected.

**Honesty note adopted as a D2 ruling:** this session's default-row ratios sit ~10% under the post-audit matrix (1.60/1.28/1.68 vs 1.76/1.43/1.84); both runs valid, rule 6 untriggered. The scorecard quotes the **range** — Express 1.60–1.76×, Fastify 1.28–1.43×, cpeak 1.68–1.84× — per D2, not either session alone. **Phase 7 closes on this verdict.** The arc worth remembering: Session 3 recorded 23k on files and had to withdraw it as a machine artifact; today's 28.6k stands on clean pre/post regime, byte-smoked equivalence, two labeled rows, and ≤4% spreads — the distance between those two numbers is the entire measurement culture built in between.


---

*Session 24 addendum (Aug 2026 — Phase 8 s1: Router + mounting; the first clean-on-contact wire-diff).*

`MountableRouter` as specced: own table, ordered `use()` stack, own error middleware, `handle` bound once (mountable twice); `Router()` with/without `new`; **static segment-aligned prefixes only** (`/api` never matches `/apix`; `:param`/`*` mounts rejected); under a mount `url`/`path` lose the prefix, `baseUrl` gains it, restored on `next()`; `originalUrl` captured pre-rewrite; `/api?x=1` → `/?x=1` as Express. Four-arity ordering: router-level → app-level → `handleErr`; `next(err)` passes a new error, `next()` the same one, throws become the next layer's error; path-scoped supported. Hot path preserved: `#globals` prefix until anything mounts, then the registration-ordered `#stack`. **`maxParamLength` shipped** (default 100, Fastify's; decoded length; 414 pre-handler; `*` exempt; `Infinity` disables; applies in mounts) — audit item #14 closed. Documented deviation for the compat table: **every `use()` runs before any route in registration order** (Express applies a `use()` only to routes registered after it). 31 mount tests + a 23-request Express 4.22.2 wire-diff corpus — **wire-identical on first run, no corrections needed**: the oracle-first discipline's maturity moment. Gates: 626/626; paired hello −0.13% PASS.


---

*Session 25 addendum (Aug 2026 — Phase 8 s2: extended query + urlencoded/raw/text; a gate refused; a rule improved).*

**Extended query, oracle-first and stricter:** `qs@6.15.3` + `body-parser@1.20.6` pinned exact. Linear reimplementation (split pass + balanced-bracket scan, zero regex); decision 10 enforced beyond the oracle — null-prototype throughout, any segment that is an own `Object.prototype` property drops its whole key; qs's `arrayLimit` overflow **side-channel reproduced via WeakMap** so later merges behave identically — oracle fidelity down to the quirk. 117-string differential structure-identical; 15-vector pollution suite with explicit stricter-than-qs assertions; linear-time check; 10k × 3-seed fuzz with option sampling. Wired as Express's own qs options **minus `allowPrototypes: true`**.

**One reader, four parsers:** decision-13 listener reader factored into `body/read.ts` (declared-length pre-check, per-chunk count, `pause()` on overflow, single-chunk no-concat, disconnect tagging) — `parseJSON`'s 19 tests incl. the ECHO-1 equivalence suite passed unchanged, proving the refactor. `urlencoded` (simple = `node:querystring`; extended = ours, body-parser's depth-32 → 400, param limits → 413), `raw` → Buffer, `text` with UTF-8/Latin-1/ASCII/UTF-16LE natively — anything else **415 before reading a byte** (zero-dep held; no iconv). Rule-3 equivalence ×4 parsers, byte-exact limits ×4, chunked overflow → delivered 413 + close across all (decision 13's wire rule generalized). 73-probe wire-diff vs Express + body-parser identical, with **three deviations asserted explicitly as tests**: `req.body = {}` on skipped requests; exotic charsets (koi8-r) → 415 where Express decodes via iconv; no `allowPrototypes` escape hatch.

**A gate refused — the culture in one sentence:** paired hello ran three times, every run breaching the >10% intra-config spread (host lost ~15% absolute mid-session: Spotify, Docker Desktop backend, Task Manager). The diff shows no hot-path change, "**but the gate is measured, not argued — so no claim.**" Re-adjudication is next session's first item against the frozen `ed40a62` baseline. **Rule improvement adopted (session's proposal):** BUSY-MACHINE's 20% CPU bar read OK at 8–14% while pair spreads hit 22.8% — CPU sampling is a proxy; the pairs are the measurement. Rule 2 amended: **spread voids, CPU advises.** Gates: 848/848 (from 626); paired echo +2.58% reported.


---

*Session 26 addendum (Aug 2026 — PHASE 8 CLOSED: the import-line port passes, 41/41).*

**s2 hello gate re-adjudicated on a quiet host: VALID, PASS** (+0.39% median, spreads 6.7/6.8%). `ab.mjs` upgraded same-session to operationalize the amended rule 2: per-run values + intra-config spreads printed, **SPREAD-VOID stamped above 10%**, `--mode=gate` verdicts against the −2% budget.

**The exit test — the sentence written twenty-plus sessions ago is now a passing test.** `app.express.mjs`: a ~100-line real Express 4 app (json/urlencoded, `express.static` on a mount, `/api` router nesting `/users` + `/admin`, mount-scoped auth, params/query, router- and app-level error middleware, `app.all("/*")` 404, `app.disable/set`). `app.zonix.mjs` **differs in line 1 only — asserted textually** — and diffs 41/41 wire-identical on the corpus. Four real gaps surfaced and landed: Express's settings API (`set/get/enable/disable/enabled/disabled` with `trust proxy`/`etag`/`query parser`/`subdomain offset` honoured); `app.all()`/`router.all()` + the parser/static/Router exports on the default export; **HEAD precedence** — a wildcard-only HEAD match now yields to a specific GET route, matching Express's registration-order behaviour; `req.body = {}` on skipped requests with an internal flag keeping later parsers in the chain working. Deviations kept and asserted: query-parser default is **simple** (Express 5's choice; Express 4 defaults extended — example sets it explicitly); charset compared case-insensitively.

**Gates:** 894/894; all oracles green. The s3-build's own hello gate: **two runs SPREAD-VOID under the new rule** (10.0%, 10.6%) — no regression signal, no verdict, carried to the Phase 9 open. The amendment adopted one session ago voided its own author's next gate — the system eats its own cooking. **Phase 8 CLOSED. The framework is feature-complete for v1.**


---

*Session 27 addendum (Aug 2026 — Phase 9 s1: packaging + CI; the LICENSE catch; Node 20 restored).*

**Carried gate: VALID, PASS — the quietest run of the project** (baseline spread 1.1%, candidate 0.9%; −0.55% median vs the −2% budget). Phase 8's regression gate fully adjudicated.

**Package:** `zonix-http` provisional (Swapnil's confirmation still pending; `zonix` taken at 1.0.1; `zonix-http`/`zonixjs`/`@zonixtec/zonix` all free today; rename is one field + lockfile refresh). Full publish-grade `package.json` (sideEffects false, exports map with types, `files:["dist"]`, engines ≥20, provenance publishConfig, prepack build); tsup 145 KB + d.ts + maps; coverage script with 90% thresholds; `.prettierignore`. **`pack-smoke.mjs` earned its keep on first contact: the tarball had no LICENSE** — MIT added before npm ever saw it. Smoke: pack → assert contents → install into an empty temp project → run `examples/basic` with only the import rewritten → 8 probes → **PACK SMOKE OK: zonix-http@0.1.0, 5 files, 155 KB.**

**CI:** `ci.yml` (Node 20/22/24 matrix; coverage job; pack-smoke; informational container bench) and `release.yml` (v* tags; tag==version guard, exercised locally; `--dry-run` always; real publish gated on `PUBLISH_ENABLED`). No git remote on the machine, so the identical steps ran on **official Node images locally**: 20.20.2 / 22.20.0 / 24.19.0 all green, 894/894 each; **coverage lib/ 98.9 / 93.7 / 97.8 — thresholds pass. The Node 20 claim, lost in Session 8, is restored** (GitHub Actions itself pending Swapnil's repo push). Honest notes: two bogus Node 20 failures traced to `git archive` applying `core.autocrlf` on Windows (CRLF fixtures) — working-tree tarball fixed it, code untouched; Docker Desktop restored post-gate as the only local path to Node 20/24.


---

*Session 27.5 note (Aug 2026 — SECURITY.md drafted under the README hold; APPROVED).*

The session drafted the upstream-independent half while the filings hold stands. Reviewed against the full record: every guard claim traces to a shipped mechanism and a named suite — byte-exact limits (at-limit passes, one-over 413, Content-Length pre-refusal), maxParamLength 414, depth/param caps with linear-time fuzz, 415-before-read charsets, delivered-413-never-reset, resolve-then-prove traversal with dotfile fall-through, null-proto query/cookies + own-Object.prototype-segment drops + registration-time params guard, CRLF rejection across set/append/location/cookies/content-disposition, timingSafeEqual, no-codegen/no-backtracking parsers each with a pinned oracle. The smuggling line is exactly honest: owned by `node:http`, defaults not loosened. Two notes attached: (1) the 72h-ack / 14-day-assessment SLA is Swapnil's personal commitment to consciously accept (or widen to 30 days) before publish; (2) the README session's cross-check gate extends to SECURITY.md — every bracketed suite cite must resolve to an existing test file. Checklist item 2 gains: enable GitHub private vulnerability reporting once the repo exists.