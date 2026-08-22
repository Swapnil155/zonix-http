# HANDOFF

**Phase:** 8 — **CLOSED** (S25, 2026-08-22). Exit test green: a real Express
app ported by its import line alone, 41/41 wire-identical. s2 hello gate
re-adjudicated VALID (spreads 6.7/6.8%) **PASS +0.39%**. **Next session:
Phase 9 opens** (packaging + CI, then README, then publish 0.x).

## Carry-over (first thing at the Phase 9 open)

Quiet host → `node bench/ab.mjs --scenario=hello --runs=7 --mode=gate` on
the current `dist/` (s3 build: settings API, `all()`, HEAD-wildcard
precedence, `#bodyDefaulted` field) vs `bench/.baseline-build` (still the
`ed40a62` dist). Two runs this session were SPREAD-VOID (10.0%, 10.6%;
medians −0.10%/+1.24%). Record it; that is the Phase 8 regression gate.

## Done this session (Phase 8 s3)

`ab.mjs` prints per-config values + spreads, SPREAD-VOID >10%, `--mode=gate`.
`test/compat/express-port/app.{express,zonix}.mjs` + `express-port.test.ts`
(43). Landed for the port: `app.set/get(name)/enable/disable/enabled/
disabled` (trust proxy, etag, query parser, subdomain offset honoured),
`all()`, `zonix.json/urlencoded/raw/text/static` on the default export, HEAD
wildcard yields to specific GET, **`req.body = {}` on a skipped request**
(body-parser semantics; defaulted flag keeps later parsers working).
**894/894.** Section "Phase 8, session 3" in `bench/results.md`.

## Phase 9 plan (from CLAUDE.md)

Name decision (`zonix-http` / `zonixjs` / `@zonixtec/zonix`); exports map +
types, `files:["dist"]`, `sideEffects:false`, engines ≥20; tsup esm+dts;
GitHub Actions CI Node 20/22/24, coverage ≥90% lib/, bench job
informational; publish with provenance on tags; 0.x until dogfood. README:
quick start, compat table (incl. the deviations asserted in
`express-port.test.ts`, `body-parser-diff.test.ts`, `mount-express.test.ts`),
scorecard as ranges with both M1 rows, "Measured and rejected", SECURITY.md.
Swapnil-side: scorecard ranges in CLAUDE.md; Express docs PR; Fastify
discussion decision — nothing filed here.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework and file
claims: container only, regime pre AND post, REGIME-FLIP voids. Host:
BUSY-MACHINE, intra-config spread >10% = lying. Rule 9: table-size claims carry a
zonix flat-control; sign-sensitive claims need a second environment.
