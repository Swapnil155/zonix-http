# HANDOFF

**Phase:** 7 — OPEN. Negotiator landed and wired; tests green. Next: ETag/fresh
→ 304, range/206, compression, serveStatic cache (the W1/M1 stack).

## Done this session (2026-08-22 — ECHO-1, the cpeak echo gap)

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
