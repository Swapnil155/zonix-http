# HANDOFF

**Phase:** 9 — IN PROGRESS (S26, 2026-08-22). s1 done: packaging + CI.
Carried Phase 8 gate adjudicated **PASS −0.55%** (spreads 1.1/0.9%). Next
session: **README + scorecard** (ranges, both M1 rows, compat table from the
asserted deviations, "Measured and rejected"), SECURITY.md; then 0.1.0.

## Done this session (Phase 9 s1)

Name **`zonix-http` (provisional; `zonixjs`, `@zonixtec/zonix` also free;
`zonix` taken)** — one field + lockfile to change. package.json: sideEffects,
exports map, provenance publishConfig, prepack, sourcemaps; scripts
`format:check` / `coverage` (90% thresholds lib/) / `pack:smoke`;
`.prettierignore`; `LICENSE` (MIT). `scripts/pack-smoke.mjs`: tarball →
temp install → examples/basic against the installed package, 8 probes OK.
`.github/workflows/ci.yml` (Node 20/22/24, coverage, pack smoke, bench
informational) + `release.yml` (tag guard, dry-run always, publish gated on
`vars.PUBLISH_ENABLED`). **Suite 894/894 on Node 20, 22, 24** (20/24 on the
official images locally — no remote/gh here; first push runs Actions).
Coverage lib/ 98.9/93.7/97.8%. Section "Phase 9, session 1" in `bench/results.md`.

## Swapnil-side before 0.1.0

Confirm the name; create the GitHub repo + push (CI runs); add `NPM_TOKEN`
secret; set `PUBLISH_ENABLED=true` only when cutting 0.1.0; `repository`/
`bugs`/`homepage` fields once the URL exists. Scorecard ranges in CLAUDE.md;
Express docs PR; Fastify discussion — nothing filed here.
