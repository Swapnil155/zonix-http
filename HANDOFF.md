# HANDOFF

**Phase:** 9 — s2 DONE (S29, 2026-08-24). SECURITY.md + README shipped.
**Swapnil dropped the upstream-filings prereq** (S29, his call): README shows
the scorecard ratios neutrally — no Fastify-mechanism/W2 claim, footnote says
"workload/harness-specific, rerun on yours" and prints the 0.91–0.98× losses
plainly. Gates passed: every README number verbatim in results.md; all 13
SECURITY.md test-cites resolve; quick-start snippet executed live (3 probes);
Prettier clean. `@zonix` npm scope is TAKEN (user "zonix" exists) — restJS
also invalid (uppercase). Name still `zonix-http` pending his word.
**Next: s3 — cut 0.1.0** after his checklist below.

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
`bugs`/`homepage` once the URL exists; file the Express docs PR + Fastify
discussion (nothing filed here) — both unblock the README.
