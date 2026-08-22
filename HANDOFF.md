# HANDOFF

**Phase:** 7 — CLOSED on the M1 verdict (S22, 2026-08-22, container). Next
session: **Phase 8 opens** (Router class, path-mounted `use`, nesting,
`originalUrl`/`baseUrl`, 4-arity error middleware, urlencoded/raw/text parsers,
extended query parser + pollution/fuzz suites; exit = real Express app ported
by changing only the import line).

## Done this session (M1 adjudication, container, two rows)

Prereq: `ZONIX_STATIC_CACHE=1` knob in `bench/servers/zonix.js` (serveStatic
cache over mirrored fixtures, fixed mtime); `bench/smoke-cache.mjs` 32/32
wire-identical cache-on cold+warm vs default (host + container); matrix/smoke
take `zonix-cache` as a framework id. Regime clean pre+post, spreads ≤4%,
Fastify unimodal. **file-1kb: default 11,337 → 1.60× Express / 1.28× Fastify /
1.68× cpeak; cache-on 28,603 → 4.03× / 3.24× / 4.25× (2.52× own default) —
≥2× MET on the cache row, labeled opt-in.** file-1mb informational (cache
1.21× own default). Default-row ratios ~10% under the post-audit matrix —
scorecard should quote ranges (D2). Section "M1 adjudication 2026-08-22" in
`bench/results.md`.

## Next

Phase 8 as above (test-first, Express wire-diff), then Phase 9 (npm; README
scorecard as ranges with both M1 rows). Swapnil-side: scorecard ranges in
CLAUDE.md; Express docs PR; Fastify discussion decision — nothing filed here.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework and file
claims: container only, regime pre AND post, REGIME-FLIP voids. Host:
BUSY-MACHINE, intra-config spread >10% = lying. Rule 9: table-size claims carry a
zonix flat-control; sign-sensitive claims need a second environment.
