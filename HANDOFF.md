# HANDOFF

**Phase:** 9 — s2 + s3-local DONE (S30, 2026-08-24). SECURITY.md + README
shipped. **Filings prereq dropped by Swapnil (S29, his call):** README shows
scorecard ratios neutrally — no Fastify-mechanism/W2 claim; footnote says
workload/harness-specific, rerun on yours; 0.91–0.98× losses printed plainly.
Gates: every README number verbatim in results.md; 13/13 SECURITY.md
test-cites resolve; quick-start snippet run live; Prettier clean.

Name **`zonix-http` CONFIRMED** (S30 "go ahead"; `@zonix` scope TAKEN on npm —
user "zonix" exists; uppercase names invalid). **Release battery green on this
tree (S30):** typecheck/build/format 0, suite 894/894, coverage lib/
98.86/93.72/97.77 thresholds pass, PACK SMOKE OK zonix-http@0.1.0. This is
the same battery release.yml runs on the tag.

## Remaining = Swapnil's launch sequence (nothing left for Claude Code)

1. `git add CLAUDE.md HISTORY.md && git commit` (spec still uncommitted).
2. Create the GitHub repo; `git remote add origin <url> && git push -u origin
master` — first push runs the real CI matrix.
3. Repo settings: add `NPM_TOKEN` secret; set repo VARIABLE
   `PUBLISH_ENABLED=true`; enable private vulnerability reporting.
4. Add `repository`/`bugs`/`homepage` to package.json, commit, push.
5. `git tag v0.1.0 && git push origin v0.1.0` — release.yml checks
   tag==version, dry-runs, then publishes with provenance.
6. After publish: pick the dogfood service (v1.0.0 clock starts).

If any release.yml step fails on GitHub, open the next session with the log;
nothing publishes until PUBLISH_ENABLED is set, so a failed run is free.
