# HANDOFF

**Phase:** 8 — IN PROGRESS (S23, 2026-08-22). Phase 7 CLOSED (M1 MET,
`cbf9d42`). s1 done: Router class + mounting + 4-arity error middleware +
maxParamLength. Next: parsers (`urlencoded`/`raw`/`text`), extended query
parser + pollution/fuzz suites; then the express-port exit test closes P8.

## Done this session (Phase 8 s1)

`lib/router/mount.ts`: `Router()` (with/without `new`, `zonix.Router`),
`use(path?, fn|router|4-arity)`, static segment-aligned prefixes, url rewrite

- `baseUrl`/`originalUrl` (restored on `next()`), router-level then app-level
  error middleware before `handleErr`, `registerRoute` shared. Radix class →
  `RouteTable` (alias kept for micro.ts). `maxParamLength` (default 100,
  decoded length, `*` exempt, `Infinity` off) → 414 `URI_TOO_LONG` in `find`.
  Hot path: `#globals` prefix unchanged; `#stack` (registration order) only
  once something is mounted. Deviation to document: every `use()` runs before
  routes. **626/626; Express wire-diff 23/23 on a two-router app; hello gate
  86,995 → 87,034, median −0.13%, range −2.5..+3.4% PASS.** Section "Phase 8,
  session 1" in `bench/results.md`.

## Next

Parsers + extended query (depth ≤5, key caps, proto keys dropped,
null-proto; pollution + fuzz suites, qs as rule-8 oracle), then the
express-port exit test (real Express example app, import line only).
Swapnil-side: scorecard ranges in CLAUDE.md; Express docs PR; Fastify
discussion decision — nothing filed here.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework and file
claims: container only, regime pre AND post, REGIME-FLIP voids. Host:
BUSY-MACHINE, intra-config spread >10% = lying. Rule 9: table-size claims carry a
zonix flat-control; sign-sensitive claims need a second environment.
