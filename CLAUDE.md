# zonix — Zero-Dependency, Express-Compatible Node.js Framework

> Operational spec. Read fully at session start. The complete decision chronicle
> (all session addenda, withdrawn claims, investigation narratives) lives in
> **HISTORY.md — do NOT auto-read it**; consult only when provenance is needed.
> Session state: **HANDOFF.md** (read at start, update before stopping, ≤30 lines).

## Status (Session 27)

**Phase 9 s1 done: packaging + CI.** Carried gate PASS on the quietest run ever
(spreads 1.1/0.9%, −0.55%). Publish-grade package (`zonix-http` **provisional —
Swapnil's confirmation is the one open decision**; all three candidate names
free today); pack-smoke caught a tarball with **no LICENSE** before npm did —
MIT added; PACK SMOKE OK: 5 files, 155 KB. CI + release workflows written
(tag==version guard, provenance, dry-run always, publish gated on
`PUBLISH_ENABLED`); identical steps green on official Node 20/22/24 images —
**the Node 20 claim is restored**; coverage lib/ 98.9/93.7/97.8, thresholds
pass. **SECURITY.md: COMMITTED (`bfeff1d`) and APPROVED** — claims verified against
`lib/` before writing; a `commit -a` slip briefly captured the spec file and was
soft-reset correctly (SLA is Swapnil's to
consciously accept — 72h ack / 14-day assessment — or widen to 30). **README
session remains HELD on the two upstream filings.** Its gate now also verifies
every SECURITY.md bracket-cite resolves to an existing test file. Then s3 —
cut 0.1.0. Swapnil's launch checklist is in the Phase 9 spec.

## Scorecard (canonical, container matrix 2026-08-22 + M3)

| Scenario | zonix | z/express | z/fastify | z/cpeak |
|---|---|---|---|---|
| hello | 161,984 | 5.78× | 0.94× | 1.19× |
| routes-6-param | 147,712 | 5.65× | 0.91× | 1.20× |
| routes-200-param | 147,187 | 6.58× | 1.37×¹ | 1.19× |
| chain (10 mw) | 151,475 | 5.62× | 0.91× | 1.53× |
| 404 | 150,323 | 6.03× | 0.98× | 1.11× |
| post-json-echo² | 82,912 | 5.66× | **1.78×** | 1.08× |
| file-1kb (default) | 11,337–12,458 | 1.60–1.76× | 1.28–1.43× | 1.68–1.84× |
| file-1kb (cache, opt-in)³ | 28,603 | **4.03×** | **3.24×** | **4.25×** |

¹ Harness-configuration-qualified — see W2 wording below.
² ECHO-1 re-run 2026-08-22 (same-session, 8 rounds); other rows unchanged within noise that session.
³ M1 adjudication 2026-08-22: byte-smoked wire-identical, warm steady-state, opt-in `{cache:{maxBytes}}`; default row = D2 range across both valid container sessions.

Footprint (M3): install **116 KB** vs 2.21 MB / 7.38 MB (19× / 65×); files **5** vs
618 / 2,033; packages **1** vs 68 / 56; cold import 16.2 ms vs 77.5 / 68.8; first
import on AV host 21.6 ms vs 1,240 / 1,487 (57× / 69×); RSS@10k 47.1 MB vs 100.8 /
56.3 (1.20× vs Fastify — stated plainly). Static facts unconditional; timing
regime-annotated. Determinism is a parameter: zonix unimodal everywhere;
Fastify per-process lottery (see W2). Engineering: 0 runtime deps; **894
tests** green on Node 20/22/24; coverage lib/ 98.9/93.7/97.8 (≥90% gated);
tarball 5 files, 155 KB.

## Hard constraints (never violate)

1. Zero runtime dependencies (`node:` builtins only; devDeps fine).
2. TypeScript strict; ESM only; Node >= 20 (`engines`); verified 20/22/24 on
   official images (S27) — GitHub Actions pending repo push.
3. No monkey-patching http prototypes — extension via subclasses passed to
   `http.createServer({ IncomingMessage, ServerResponse })` only.
4. Express-compatible middleware signature `(req, res, next)`; `next(err)` routes
   to error handling.
5. Every feature lands with tests in the same commit.
6. No `eval` / `new Function` / codegen; no regexes with nested quantifiers
   (linear parsers only). (Decision 11 ban — survived D1 and the source audit.)

## Locked decisions (normative summaries — provenance in HISTORY.md)

1. Custom req/res subclasses; predefined class fields for V8 shape stability;
   `req.query` lazy, cached.
2. Router: radix per method, static > param > wildcard with backtracking; exact-path
   Map shortcut in front; trees keyed by uppercase method; zero-alloc URL walk
   (no `split`); duplicate registration throws; trailing slash normalized;
   malformed percent-encoding → 400; **HEAD falls back to GET, explicit HEAD
   routes win** (S20 — Express wire-diff superseded v1's no-fallback stance).
3. Middleware: global chain then route chain, precomposed per route and cached
   (invalidate on late `use()`); double-`next` inert; sync completion path — async
   machinery only for thenables.
4. Central error dispatch: sync throws + rejections always caught; `headersSent` →
   socket destroyed **and handleErr still invoked** (A1) — handlers must guard
   `res.headersSent`; `handleErr` throwing → logged bare 500; dispatch never rejects.
5. Client disconnects tagged `clientDisconnect: true` — codes `ECONNRESET`,
   `EPIPE`, `ERR_STREAM_PREMATURE_CLOSE`, `ERR_STREAM_DESTROYED` (A2), plus
   peer-verifiably-gone. Never crash on abort.
6. `sendFile`: stat-first, MIME from curated map, Content-Length; **buffered path
   for files ≤ 32KB** (readFile + single end — F1); streamed via `pipeline` above
   (`.pipe()` swap declined with numbers); `res.json` sets Content-Length.
7. Handler/Middleware return type `unknown` (A3); returns ignored.
8. `req.params` = **plain object** + registration-time rejection of
   `:__proto__`/`:constructor`/`:prototype` (keys are developer patterns — audit #9).
   `req.query` keys are attacker-controlled → **stays null-prototype**. Never
   "unify" these two.
9. Express sugar is core, not a shim; lazy accessors (pay-for-what-you-use).
   `res.send` semantics locked to Express (string→html unless typed, Buffer→octet,
   object→json, legacy number form throws). `req.host` = **Express 5 semantics**
   (includes port, trust-proxy aware, IPv6-bracket safe); `hostname` port-stripped
   (D6). String bodies force `charset=utf-8`. 404 default JSON unless `fallback()`.
10. Inlined third-party equivalents keep their locked security postures: extended
    query (depth ≤ 5, key caps, proto keys dropped, null-proto) [P8]; negotiation
    linear-parse only [P7]; trust proxy default OFF; weak ETag + fresh; ranges: 304 beats Range, If-Range gated,
    well-formed-but-unsatisfiable → 416, unparseable/multipart → 200 full;
    compression is plan-based (middleware installs, senders consult), ETags on
    raw body, 206 never compressed;
    cookies HMAC-SHA256 `s:`-wire-compatible; body parsers byte-counted (413),
    multipart out until v2; curated ~120-entry MIME map.
11. `createSerializer(schema)` shipped (closure-composed char-scan escaping; arrays
    delegate to `JSON.stringify` — tested never-materially-slower). Codegen Option B
    rejected on measurement (D1). `serialized(schema, handler)` HOF (D5) optional,
    unimplemented, low priority.
12. Router class + mounting (`originalUrl`/`baseUrl`, url rewrite), 4-arity error
    middleware before `handleErr` — Phase 8.
13. **Hot-path stream ingestion uses `data`/`end` listeners, never async
    iterators** — `for await` costs an iterator + eos watcher + AsyncResource +
    promise/microtask per chunk (ECHO-1: +40.9%). Body reads: byte-exact limit per
    chunk, single-chunk decode without concat, charCode BOM check, disconnect
    tagging preserved. **Wire rule: mid-stream body overflow → 413 +
    `Connection: close`, delivered — never a bare socket reset.** The equivalence
    suite (dribble-through-multibyte, chunked-at-limit, overflow-not-reset) is the
    guard.

## Binding rulings

- **D7 / Turbo:** killed at T-1 (1.362× vs 1.40× bar, no pair touched it). Never
  re-run in hope. Only door: a materially NEW design faces the SAME bars
  (≥1.40× raw, ≥1.30× Fastify, shim-inclusive) after a written mechanism claim in
  this file naming which erosion component (~20%: parsing / HOL ordering /
  per-request build) it eliminates. Falsification record: `t1/`.
- **D2 / claims:** cross-framework numbers only from same-session interleaved
  paired runs, published as ranges with the noise floor; medians never
  cherry-picked rounds; container absolutes are never the claim — ratios are.
- **W2 wording (rev. 4, binding):** lead with *zonix is unimodal and
  deterministic in every scenario, configuration, environment measured* (147–154k
  at 200 routes through every machine state; flat controls 0.97–1.01). Fastify's
  per-process throughput is bimodal — located to an IC state inside
  `process.nextTick` (MH-1: 0.36% vs 10.25% self-time, same tier, no deopt) —
  with fast-mode availability gated by **table size × routes touched × session**:
  20/20 at 6 routes; at 200 routes 8/20 single-path → 0/20 multi-path, **0/53
  across all multi-path observations**. Since real traffic touches multiple
  routes, **1.37× at 200 routes is the realistic-workload ratio**; the ≈1.12×
  single-path EV figure is retained for honesty about the lab case. Per-session
  availability caveat stated wherever published. ISSUE.md discloses upstream
  before any README claim ships.
- **Upstream queue (both ready — Swapnil files this week, his wording final):**
  Express docs PR (`upstream/express-docs/PR.md`) — approved. Fastify ISSUE.md —
  discussion-class with `modes.mjs`/`suppressor.mjs` attached; filing ruled YES
  (disclosure precedes our README claim); optional `--log-ic` follow-up if the
  thread engages, never a blocker.
- **README plans:** honest-benchmark page (ranges + noise floors + docker-repro),
  compat table (incl. Express-4 `req.host` difference; `req.is` returns matched
  type; `use()` ordering all-before-routes vs Express's registration-positional;
  `If-None-Match: *` inherited quirk chosen; ETag default off; unsatisfiable
  `bytes=` → 416; body parsing: `req.body = {}` on skipped requests, charsets
  beyond UTF-8/Latin-1/ASCII/UTF-16LE → 415 (Express decodes via iconv), no
  `allowPrototypes`; query-parser default simple, Express-5-aligned —
  Express 4 defaults extended), "Measured and rejected" section (Option B codegen, `.pipe()` swap, 256KB
  highWaterMark, Turbo).

## Performance rules (permanent)

1. Pay-for-what-you-use: sugar is lazy; unused features cost zero per request.
2. Regression gate ≤ 2%/phase on hello, adjudicated by same-session paired A/B
   (≥5 pairs, median) — never cross-session medians. **Spread voids, CPU
   advises** (S25): any run with intra-config spread > 10% voids the
   adjudication regardless of the CPU preflight — BUSY-MACHINE sampling is an
   advisory; the pairs themselves are the validity measurement. Re-run on a
   quiet host; no claim from a voided gate.
3. Every fast path: shares central error dispatch + ships a byte-identical
   equivalence test vs the slow path.
4. ETag off by default (deviation from Express, documented).
5. Measurement tiers: effect ≥ noise floor (~5% e2e) → plain paired medians;
   below → paired-process microbench + profile self-time (within-run). Kept
   micro-opts carry their own microbench + equivalence test. Unmeasurable-from-zero
   → reverted.
6. Anomaly protocol: any ≥2× session-over-session move (ours or theirs) is a
   harness/environment defect until proven otherwise — git diff the harness, rerun
   interleaved, only then record.
7. Regime & load checks, PRE **and** POST every file scenario (mid-run flips void
   the session: REGIME-FLIP). Degraded = opens < 20,000/sec OR open-vs-fd-read
   ratio > 40× (both mid-gap between measured regimes: clean ≈48k@12.5× host /
   ~600k@5× container; filter-driver ≈5k@124×). Constants in ONE module
   (`bench/regime-constants.cjs`) shared by `regime.mjs` + `probe.cjs`. Every
   reading records its context fingerprint (platform, os.release, cwd, tmpdir,
   execPath) — "the machine" can be two machines or two times. BUSY-MACHINE
   sampling before every scenario (no spin-loop probes).
8. Oracle differential tests mandatory for every inlined-package-equivalent
   module, pinned originals as devDeps (current: content-disposition@0.5.4,
   type-is@1.6.18 + 2.1.0, cookie-signature wire-verified, negotiator@0.6.3,
   fresh@0.5.2, range-parser@1.2.1, etag@1.8.1, compression@1.8.1 + nested
   negotiator@0.6.4 + compressible — encoding tie-break follows 0.6.4, accepts
   follows 0.6.3, both documented).
   Your own tests encode your own misunderstanding; the oracle doesn't.
9. Competitor claims: table-size/scaling claims carry a zonix flat-control in the
   same run; sign-sensitive claims need a second environment (container / CI /
   different hardware) reproducing sign and rough magnitude.
10. **Token discipline (new):** this file stays lean — session narratives go to
    HISTORY.md as addenda, only binding outcomes get summarized here; status block
    ≤ ~15 lines. Test runs use quiet reporters (failures verbose). Bench stdout →
    files; reports quote medians + spreads only. Read `results.md` by section,
    never whole. No bench artifact ships without its correctness tests as
    committed files.

## Active specs

**ECHO-1: CLOSED** (Session 17 — +40.9% paired 7/7; echo 1.78× Fastify / 1.08×
cpeak; listener-read mechanism; cpeak's guards verified real — nothing adopted was
a skipped guard; latent overflow-reset defect fixed. Full record: HISTORY.md +
`results.md` "ECHO-1 2026-08-22".)

**MH-1: CLOSED — MOOD** (Session 18 — one frame, `process.nextTick` IC state,
~28×/call, same tier, no deopt; suppressor = table size × routes touched; zonix
deterministically on the fast side; nothing enters rule-5. Full record:
HISTORY.md + `results.md`.)

**Phase 7: CLOSED (Session 23).** Full stack shipped oracle-first — negotiator/
accepts/format, fresh/range, etag/304, 206/Accept-Ranges, compression, static
memory cache — and **M1 adjudicated MET**: cache row 4.03×/3.24×/4.25× vs the
field, default row 1.60–1.84× range per D2. Record: HISTORY.md + `results.md`
"M1 adjudication 2026-08-22".

**Phase 8: CLOSED (Session 26).** Router/mounting/4-arity/`maxParamLength`;
extended query + all body parsers; settings API, `.all()`, HEAD precedence
refinement, `req.body` skip semantics. **Exit met: import-line-only Express
port, 41/41 wire-identical, source diff asserted textually.**

**Phase 9 (npm) — CURRENT, s1 done.** DONE: package.json publish-grade, tsup
build, pack-smoke (caught the missing LICENSE), CI + release workflows, three-
Node verification on official images, coverage thresholds passing. **s2 (next
session; PREREQ: both upstream filings submitted — disclosure precedes the
README that cites them):** README — quick start <5 min, compat table from the
asserted deviations, scorecard with D2 ranges + both M1 rows + docker
reproduction, footprint table, determinism/W2 rev-4, "Measured and rejected"
(Option B, `.pipe()`, 256KB hWM, Turbo) — plus SECURITY.md. **s3: cut 0.1.0.**

**Swapnil's launch checklist (all his, none Claude Code):** (1) confirm the
name — recommendation `zonix-http`; (2) create the GitHub repo + push (CI runs
for real; enable private vulnerability reporting in settings); (3) add `NPM_TOKEN` secret; (4) set `PUBLISH_ENABLED=true` only at
the 0.1.0 cut; (5) add repository/bugs/homepage to package.json once the URL exists, and
decide the security contact (domain alias like security@zonixtec.com if
available, else keep personal + GitHub advisories primary) + consciously accept
or widen the 72h/14d SLA; (6) file the Express docs PR; (7) file the Fastify issue; (8)
`git add CLAUDE.md HISTORY.md && git commit` — also ends the floating-file
commit accidents; (9) **pick the dogfood service now** (a Zonixtec internal
tool or personal app) so the v1.0.0 clock starts the day 0.1.0 publishes.

## Repository layout & structure rules

As-built full tree and the four structure rules (import direction is law; one dir =
one inlined package with its oracle; test/ mirrors lib/ plus security/ + fuzz/;
every file has one legal home — `utils/` is banned) — unchanged; full annotated
tree in HISTORY.md ("Repository layout"). New files continue to grow into that
tree; `http/serialize.ts` has its slot.

## Test plan (operational)

node:test + supertest via tsx; every test file imports the unhandledRejection
tripwire; ephemeral ports, auto-close. Suites: core (router/middleware/response/
errors/disconnect), compat (req/res/send-matrix/cookies-signed/mount [P8]/
express-port [P8]), http (etag-fresh/range/negotiation/proxy), body, middleware,
security (prototype-pollution, path-traversal — encoded/double/backslash, CRLF —
assert header LINES not substrings, limits-dos, slowloris via raw-client), fuzz
(seeded mulberry32, seed printed on failure; parsers get 10k-input defined-outcome
loops with O(n) time caps). Oracle differentials per rule 8. Assertions on wire
behavior prefer diffing against real Express (two-halves pattern) — hand-written
expectations have been wrong twice.

## Non-goals (with reasons — do not relitigate)

(a) platform/ecosystem owns it better, (b) permanent security surface
disproportionate to value — paid for twice (Content-Disposition, Turbo), (c)
trivially a Connect-compat middleware. HTTP/2 (a); WebSockets (a+c — `app.server`
upgrade escape hatch exists); multipart uploads (b — busboy-class streaming
parser, v2 at best); clustering (a); template engine (a+b — XSS surface);
auth/session (b+c — passport-class plugs in); request logging (c — rule 1);
schema validation (b + decision-11 — zod/ajv plug in; `createSerializer` is
serialization only); JSONP (legacy XSS-adjacent, CORS obsoleted it);
`app.param()` (c); regex route paths (b + decision-11 — path-to-regexp is where
Express's 2024 ReDoS CVE lived; exotic matching falls through to middleware).

## Session workflow

Start: read this file + HANDOFF.md → confirm current task in one line → proceed;
don't re-plan finished phases; HISTORY.md only on provenance questions. During:
test-first on router/error paths; run affected tests per change, full suite before
commit; conventional commits. End (or on "handoff"): update HANDOFF.md — phase,
done, failing, exact next task, open questions, ≤30 lines. Honest status over
optimistic status; never claim unrun results. Build, don't ask — stop only for
genuine contradictions with this file.