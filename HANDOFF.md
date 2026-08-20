# HANDOFF

**Phase:** 5.5 — steps 1–2 done through item 6. **Stopped at item 7 awaiting Swapnil's serializer decision.**

## Done this session

- **Step 1 (instrumentation).** Bench matrix expanded to 6 scenarios × 3 frameworks (`bench/servers/`,
  `bench/run.mjs`, `bench/run.sh` now a wrapper). `npm run profile` = `--cpu-prof` + a self-time ranking so the
  "flamegraph before guessing" rule works from the terminal. Added `bench/ab.mjs` (end-to-end A/B),
  `bench/micro.ts` + `bench/micro-ab.mjs` (router A/B), `bench/snapshot.mjs`. All results in `bench/results.md`.
- **Step 2 items 1–6.** 1 and 2 were already satisfied in v1 (verified with `curl -v` / code, no change).
  3, 4, 5, 6 implemented and kept, each with a recorded number. Chain scenario is the big winner:
  `#runChain` self time 4.91% → gone, zonix's own frames on chain 9.1% → 3.4%, end-to-end +5.0% then +6.5%.
- **Performance rule 3 satisfied:** `test/fastpath.test.ts` proves fast path and full chain produce byte-identical
  wire output across 12 targets (incl. errors, sendFile, redirect, 404) and that both funnel through one dispatcher.
- **Amendment A2 applied:** `ERR_STREAM_DESTROYED` added to the disconnect code list.
- 147 tests green on Node 22.20.0 **and** 20.20.2; typecheck, build, prettier clean; still zero runtime deps.

## Two findings that change how this repo measures

1. **End-to-end noise floor here is ~5%** (proved by A/B-ing a build against itself in four harness designs;
   fastify drifted +21% between sessions). **Absolute cross-session rps must not be compared** — use
   `bench/ab.mjs` paired deltas, profile self-time shares, or same-session ratios.
2. **zonix's own code is 3.4–9.1% of a request** (`writev` alone is 45%). So the "< 1% on its target scenario
   gets reverted" rule cannot be adjudicated end-to-end for router-level work — the subsystem is smaller than
   the noise. Items 4 and 5 were **kept as a deliberate deviation** (see `bench/results.md`); if the rule is read
   strictly, **item 5 is the one to revert** — item 4 costs no complexity.

## Next

1. **Item 7 — decide Option A (closures) vs Option B (codegen + ban exception).** Fully measured, nothing
   implemented. Recommendation and numbers in `bench/results.md`; short version: most of the win is the escaping
   technique, which Option A also gets; B's remaining edge is worth ~0.3–0.8% end-to-end.
2. Item 8 (GC audit, `--trace-gc`) — not started.
3. Phase 5.5 exit bar (≥95% of Fastify on hello) **is not met and not currently measurable** — 89.1% this
   session, 108% last session for the same build. Needs a quiet machine before it can be certified either way.

## Blockers

Item 7 decision. Item 8 and the exit bar are unblocked but should follow it.
