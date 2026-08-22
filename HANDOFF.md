# HANDOFF

**Phase:** 7 — BUILD DONE (S21, 2026-08-22). Oracle-first, all green: negotiator +
accepts/format (S14), fresh/range (s1), ETag + 304s (s2), 206 + Accept-Ranges +
412/If-Range + compression() (s3), serveStatic memory cache (s4, `4421b7e`).

## Done this session (Phase 7 s4 — serveStatic cache, opt-in)

`serveStatic(root, { cache: { maxBytes } })`, off by default: `lib/internal/
file-cache.ts` (LRU by bytes, Map-ordered, refuses oversize); `sendFile` split
into resolve + `#sendEntity` so `ZonixResponse.sendCached` runs the same
412/304/206/compression wire logic over cached bytes; one stat per hit,
mtime/size change → evict + reread; uncached path untouched. 20 tests incl.
disconnect mid-send and **cached-vs-uncached equivalence: 36 probes × 5 paths,
miss and hit, wire-identical.** **572/572; hello gate 86,701 → 87,494, median
−0.09%, range −1.3..+3.3% PASS; file-1kb paired +4.99% (5/5, host degraded
regime — reported, not claimed).** Full record: `bench/results.md` "Phase 7,
session 4"; earlier sessions have their own sections there.

## Next (exact)

1. **M1 two-row adjudication, container** (D8 `--cpus=8 --abort-busy`, regime
   pre+post, fingerprint): row A zonix-default vs Express/Fastify/cpeak; row B
   zonix-cache-on (labeled opt-in) vs the field — ≥2× applies to row B only.
   Prereq: cache-on env knob in `bench/servers/zonix.js` (file routes use
   `res.sendFile` today; row B needs `serveStatic` with `cache`), byte-smoke
   before benching (`bench/smoke-servers.mjs`).
2. Phase 7 exit test (wire-level 304/206/Content-Encoding) + phase gate.
3. Then Phase 8 (Router class, mounting, parsers).

Swapnil-side: file Express docs PR; decide on the Fastify discussion issue.
Nothing is filed from this repo.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework and file
claims: container only, regime pre AND post, REGIME-FLIP voids. Host:
BUSY-MACHINE, intra-config spread >10% = lying. Rule 9: table-size claims carry a
zonix flat-control; sign-sensitive claims need a second environment.
