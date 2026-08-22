# HANDOFF

**Phase:** 7 — IN PROGRESS. Done oracle-first: negotiator + accepts/format
(S14), fresh/range (s1), ETag + 304s (s2), single-range 206 + Accept-Ranges +
412/If-Range, and compression() (s3). Next: serveStatic memory cache, then
the M1 ≥2× adjudication in the container; then Phase 7 exit test + gate.

## Done this session (2026-08-22 — Phase 7 session 3: 206 + compression)

Ranges in `send@0.19.2`'s exact order (412 → 304 → Range → 416/206/200),
`Accept-Ranges: bytes`, If-Range by tag/date; helpers differential vs send's
own methods; 21-probe × 2-file Express wire-diff identical. `compression()`:
gzip/deflate/br via node:zlib, in-house `preferredEncoding` (negotiator 0.6.4
tie-break, differential), `isCompressible` (differential vs `compressible`),
Vary/threshold/no-transform/HEAD/no-benefit/206-untouched; zero cost when not
mounted; Express+compression@1.8.1 wire-diff 11×7 identical. **552/552; hello
gate 87,379 → 87,443, median of paired deltas −0.28%, range −2.2..+1.0% PASS.** Section "Phase 7, session 3" in `bench/results.md`.

## Done earlier (2026-08-22 — Phase 7 session 2: ETag + 304s)

`etag@1.8.1` pinned exact; `lib/http/etag.ts` (entityTag/statTag/computeEtag/
compileEtag) with differential + 10k fuzz green BEFORE wiring. App option
`etag` (default OFF, rule 4) + route-level `etag()` middleware; `send`/`json`
generate-then-fresh→304 in Express's order (two property reads when no
conditional header); `sendFile`/`serveStatic`: Last-Modified always, weak stat
tag when on, **304 before reading the file**. `test/compat/etag-304.test.ts`
(raw-socket matrix incl. `*`, weak/strong both ways, HEAD, POST, sendFile by
tag/date) + Express wire-diff with Express's default ETag (tags byte-identical,
decisions identical) + 11 docs-corpus requests. **Found by the wire-diff and
fixed: HEAD was a 404 — router now falls back HEAD→GET like Express/Fastify.**
**521/521; hello gate +0.29% (−0.4..+1.3) PASS.** Not done: 206 (next, with
Accept-Ranges). Section "Phase 7, session 2" in `bench/results.md`.

## Done earlier (2026-08-22 — Phase 7 session 1: fresh + range, oracle-first)

Items 1–2 (negotiator pinned, `lib/negotiation/`, differential + fuzz,
req.accepts family, res.format) were ALREADY DONE in Session 14 (`68bb692`)
— verified in place, 16/16 green, not rebuilt. Deferred P6 items landed:
`fresh@0.5.2` + `range-parser@1.2.1` pinned exact; `lib/http/fresh.ts`
(linear; `If-None-Match: *` landmine preserved) and `lib/http/range.ts`;
`test/http/fresh-range.test.ts` (6) + `test/fuzz/fresh-range.fuzz.ts` (3, three
seeds) BEFORE wiring; `req.fresh/stale/range` wired with Express semantics via a
one-pointer `ZonixRequest.attachResponse` link; 17 new docs-corpus requests
wire-identical to Express. **494/494; hello gate +0.38% (−1.0..+0.9) PASS.**
Section "Phase 7, session 1" in `bench/results.md`.

## Done earlier (2026-08-22 — MH-1, the mode hunt: CLOSED as mood)

`bench/mh1/{variant.js,suppressor.mjs,modes.mjs}`. Container, 3 runs, clean.
**Located:** a 200-route fast/common pair under --trace-opt/--trace-deopt/
--cpu-prof differs in ONE frame — `process.nextTick` self 0.36% vs 10.25%,
same TurboFan tier, same deopts; zonix 0.62% in every process ever profiled.
**Suppressor named, then sharpened:** the matrix's 10-path cycling traffic
(both bench server and minimal read 0/20 at 200 routes; every 1-path variant
2–4/20; no fixed route implicated); controls show it is table size × routes
touched (6 routes: 20/20 fast at 1, 2 or 6 paths; 200 routes: 8/20 → 2/20 →
0/20 at 1/2/10 paths). **Verdict: MOOD — nothing to adopt; zonix already sits
on the fast side deterministically (147–154k, no modes). Closed.** ISSUE.md
status rewritten with the located mechanism; Swapnil decides on a discussion
issue. Section "MH-1 2026-08-22" in `bench/results.md`. **Phase 7 opens next
session — firmly.**

## Done earlier (2026-08-22 — ECHO-1, the cpeak echo gap)

Profile named it: `for await` over the request stream (async iterator + eos +
async_hooks bind + microtask per chunk + GC). cpeak reads with listeners; its
byte limit and content-type gate are real, so its speed is not a skipped
guard. `lib/body/json.ts` now reads with data/end/error/close listeners,
single-chunk decode without concat, charCode BOM check — every guard intact;
mid-stream overflow now gets a 413 + Connection: close instead of a reset
(latent defect fixed). `test/body/json-equivalence.test.ts` (rule 3: one-write
vs dribbled vs chunked byte-identical, BOM split, chunked limit boundary, reset
vs 413, disconnect + tripwire). 468/468. **Paired host echo +40.9% (7/7,
+37..+48%)**; gates hello −0.14%, param +2.45% (re-run), chain −0.60%, 404
−0.55%, file-1kb +0.05% — all PASS. **Container: echo 0.58× → 1.08× cpeak,
0.94× → 1.78× Fastify, 5.66× Express.** Section "ECHO-1 2026-08-22" in
`bench/results.md`. Next: MH-1 (mode mechanism + harness suppressor), then
Phase 7.

## Done earlier (2026-08-22 — post-audit matrix + cpeak, container)

cpeak 2.9.2 pinned exact; `bench/servers/cpeak.js`; `bench/smoke-servers.mjs`
byte-checks all four servers per scenario (SMOKE OK host + container) before
benching; `matrix.mjs --frameworks=`. Table in `bench/results.md` "Post-audit
matrix 2026-08-22, container". zonix vs cpeak: 1.11–1.84× everywhere EXCEPT
**post-json-echo 0.58× — cpeak is 1.7× faster on the JSON-body path (also
beats Fastify/Express there). FIRST ITEM NEXT SESSION: profile echo, read
cpeak's parseJSON, adjudicate by paired e2e (gap ≫ noise).** Fastify ratios
unchanged post-audit (0.94/1.37/0.91/1.43). **ROUNDS=20 repro: fast mode
8/20 at 6 routes AND 9/20 at 200 — "200 never fast" is FALSIFIED; the
table-size effect exists only in bench/servers/fastify.js (0/13 fast at 200
vs 16/16 at 6), not in the minimal repro. Not filable as a table-size issue;
ISSUE.md status updated.** zonix flat control untouched (146–151k @200).

## Done earlier (2026-08-22 — Fastify source audit)

`fastify@5.12.1` + `find-my-way@9.8.0` pinned exact; hot paths read. 14-row
diff table in `bench/results.md` "Fastify source audit 2026-08-22". Verdict:
one real gap — `req.params` was `Object.create(null)` (V8 dictionary mode);
now a plain object + registration guard on `:__proto__/:constructor/:prototype`
(3 tests, 463/463). Direct microbench 1.9-2.4x build / 1.4x read; e2e param
+0.47% (6/7 pairs), hello gate -0.15% PASS. Declined with measured ceilings:
in-place static matching (46 ns/req, ~80 lines), GET-tree field (3 ns),
server timeout defaults (no mechanism; keeps slowloris posture). Codegen items
(prefix matcher, params factory) BANNED-decision-11. Nothing reverted.
Security note for the hardening checklist: zonix has no `maxParamLength`.

## Done earlier (2026-08-22 — full fresh matrix, container-official)

`bench/matrix.mjs` (new): all 8 scenarios x 3 frameworks, rotating order, 5-8
rounds, per-scenario status assertion, regime pre+post, per-round Fastify values
with a fast-band flag. `container.mjs --abort-busy` guard. Run: host 5.1% quiet,
container clean (574k opens/sec), no flip. Table in `bench/results.md` "Full
matrix 2026-08-22 (container)". Headline ratios: 0.90-0.98x Fastify on micro
JSON, 5.5-6.3x Express, **1.35x Fastify @200 routes, 1.46x Fastify / 1.79x
Express file-1kb**. Fastify ran 16/16 fast-band on small tables, 8/8 common
at 200 (Session 14's "rare" withdrawn: availability varies per session; 200
routes still 0/40 container). zonix spread breached 5% on four scenarios
(single low rounds), logged. Phase 7 continues next session as planned below.

## Done last session

**1. Negotiator, oracle-first.** `negotiator@0.6.3` pinned exactly (the version
Express 4 reaches through `accepts`). `lib/negotiation/` — `shared.ts` primitives
(JS-`\s`-exact whitespace, quote-aware splitting, negotiator's `parseFloat`
q-values and tie-break order, kept verbatim because the oracle decides),
`media-type.ts`, `encoding.ts`, `language.ts`, `charset.ts`, `index.ts` entry.
Every anchored regex in negotiator reimplemented as a char scan with identical
acceptance (decision 11). **Tests BEFORE wiring:** `test/http/negotiation.test.ts`
(4 families × curated corpora, 11/11) and `test/fuzz/accept.fuzz.ts` (10k
generated headers per family, byte parity, never-throws, linear-time check —
5/5 across three seeds). First run green both.

**2. Wired.** `req.accepts/acceptsEncodings/acceptsCharsets/acceptsLanguages`
with the `accepts` package's exact shape (spread or array; no args = full list;
returns the offered string as written; no `Accept` header = first offered;
unknown extensions skipped). `res.format` with Express semantics (`default`
fallback, `Vary: Accept` always, `Content-Type` from the key via the MIME
table with params dropped, 406 + `types` to the central error sink — new
`ErrorCode.NOT_ACCEPTABLE`, status 406 honoured by dispatch). Added to the
Express docs corpus → **wire-diffed against real Express** (8 new requests incl.
browser-like Accept headers, `identity;q=0`, 406 default, no-Accept). **460/460.**

**3. Fast-mode sampling (container, ROUNDS=20):** **0/20 at 6 routes, 0/20 at
200**, all ~105k, median ratio 1.004. Cumulative container tally: 6r fast
**2/32**, 200r **0/32**. The mode is real but ~6%/process here; the host (where
it was the small-table default) is the better place to count once quiet.
Recorded in `bench/results.md`; ISSUE.md's rate line should quote these.

## Not done (deliberately — "stop after negotiator tests green")

- Phase regression gate (rule 2) not run this session: the wiring adds no
  per-request work (all call-time, nothing precomputed), but the gate runs at
  the Phase 7 close regardless.
- `res.format` redirect courtesy body / `Vary: Accept` on `res.redirect` (the
  Phase 6 deferral) — `res.format` exists now, so `redirect` can adopt
  Express's text/html/default body next; the differential skip in
  `express-differential.test.ts` (`HEADERS_ONLY`) comes out when it does.

## Next

1. `http/etag.ts` + `http/fresh.ts` → 304 in `send`/`sendFile`/`serveStatic`
   (pin `etag` + `fresh` as oracles; landmine: `If-None-Match: *` is
   unconditional — skip freshness when there is no validator).
2. `http/range.ts` → single-range 206; `compression()`; serveStatic memory
   cache; the three Phase 7 bench scenarios in the container (W1/M1).
3. Regression gate + Phase 7 exit test (wire-level 304/206/Content-Encoding).

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework and
file claims: container only, regime pre AND post, REGIME-FLIP voids. Host:
BUSY-MACHINE, intra-config spread >10% = lying. Rule 9: table-size claims
carry a zonix flat-control; sign-sensitive claims need a second environment.
