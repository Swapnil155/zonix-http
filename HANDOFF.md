# HANDOFF

**Phase:** 8 — **CLOSED** (S25, 2026-08-22, `781e41d`). Exit test green: a real
Express app ported by its import line alone, 41/41 wire-identical. s2 hello
gate re-adjudicated VALID (spreads 6.7/6.8%) **PASS +0.39%**. **Next session:
Phase 9 opens** (packaging + CI, then README, then publish 0.x).

## Carry-over (first thing at the Phase 9 open)

Quiet host → `node bench/ab.mjs --scenario=hello --runs=7 --mode=gate` on the
current `dist/` (s3 build: settings API, `all()`, HEAD-wildcard precedence,
`#bodyDefaulted` field) vs `bench/.baseline-build` (still the `ed40a62` dist).
Two runs were SPREAD-VOID (10.0%, 10.6%; medians −0.10%/+1.24%). Record it;
that is the Phase 8 regression gate.

## Done this session (Phase 8 s3)

`ab.mjs`: per-config values + spreads, SPREAD-VOID >10%, `--mode=gate`.
`test/compat/express-port/` + `express-port.test.ts` (43). Landed for the
port: `app.set/get(name)/enable/disable/enabled/disabled`, `all()`,
`zonix.json/urlencoded/raw/text/static`, HEAD wildcard yields to specific
GET, `req.body = {}` on a skipped request (body-parser semantics). **894/894.**
Section "Phase 8, session 3" in `bench/results.md`; earlier sessions there too.

## Phase 9 plan (CLAUDE.md)

Name (`zonix-http` / `zonixjs` / `@zonixtec/zonix`); exports map + types,
`files:["dist"]`, `sideEffects:false`, engines ≥20; tsup esm+dts; CI Node
20/22/24, coverage ≥90% lib/; publish with provenance on tags; 0.x. README:
quick start, compat table (deviations asserted in `express-port`,
`body-parser-diff`, `mount-express` tests), scorecard as ranges with both M1
rows, "Measured and rejected", SECURITY.md. Swapnil-side: scorecard ranges in
CLAUDE.md; Express docs PR; Fastify discussion — nothing filed here.
