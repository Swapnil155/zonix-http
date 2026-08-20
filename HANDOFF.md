# HANDOFF

**Phase:** 5.5 — **complete except exit (a)**, which needs one decision from Swapnil. Next: Phase 6 (opens with the restructure commit).

## Done this session (session 3)

- **File items (D4) — the biggest win of the program.** Flamegraph showed file-1kb was almost pure
  stream/promise scaffolding (GC 20.3%, FastBuffer 13.9%, DOMException 11.1%).
  - **F1 buffered send ≤ 32KB**: `readFile` + one `end()`. **+98.4% e2e**, every pair positive.
  - **F2 callback `fs`** instead of `node:fs/promises`: `stat @ promises` 2.37% → 0.26%, GC 6.0% → 2.6%.
  - **F3 highWaterMark 256KB: REVERTED** (−7.6%, every pair negative).
  - **F4 `.pipe()` instead of `pipeline()`: NOT DONE** — ~2.4% ceiling on a 23.8%-idle path, against every
    disconnect guarantee. Declined on the flamegraph; overrule if wanted.
- **Serializer (D1): `createSerializer` shipped**, Option A, no codegen. Median **1.24×**, **3.52×** on small
  objects, never materially slower. Arrays delegate to `JSON.stringify` after two hand-rolled attempts measured
  0.75× and 0.54× — V8's array path is not beatable from JS without codegen.
- **Header experiment (D3): kept.** Header self-time **3.90% → 1.79%**, `setHeader` gone from the profile.
  A follow-on (send string, size with `byteLength`) measured worse and was reverted.
- **Tests: 165 green** on Node 22.20.0 and 20.20.2 — including the new buffered-path disconnect test, six
  threshold tests either side of 32KB, and a 10k-input seeded escaping fuzz suite (`test/fuzz/`, replay via `SEED=`).
- **Bench harness** now asserts each scenario's status distribution (the 404 scenario passes only at 100% 404s)
  and re-runs up to 5 samples when spread exceeds 5%.

## Exit criteria (revised)

(b) chain 97.0% of hello ✓ · (c) file-1kb 23,026 vs Express 4,270 ✓ · (d) serializer + microbench + fuzz ✓ ·
(e) header experiment recorded ✓ · (f) no kept regression ✓ · (g) methodology documented ✓

**(a) framework self-time ≤ 2.5% on hello: NOT MET at 3.1%** (medians 2.9 / 3.3 / 3.1).

## The one open decision

V8 attributes the `JSON.stringify` builtin to its calling frame, so the response encode is counted inside our
`json` frame (1.94% of the 3.1%). The framework's own dispatch machinery is **~1.16%**. Getting under 2.5%
means making `res.json` faster, which D1 rules out (serializer stays opt-in); the one legal attempt at the
remaining allocation measured worse and was reverted. **Either redefine (a) as "dispatch self-time excluding
the response encode ≤ 1.5%" (currently ~1.16% ✓), or retire it.** Full reasoning in `bench/results.md`.

## Standing measurement rules (now permanent)

Noise floor ~5% e2e; **never compare rps across sessions** (Express's own file-1kb read 14,034 one session and
4,270 the next). Use `bench/ab.mjs` paired deltas, `bench/micro-ab.mjs`, or profile self-time share. Trust an
e2e verdict only when every paired run agrees in sign.

## Next

1. Settle exit (a), then Phase 5.5 closes.
2. Item 8 (GC audit, `--trace-gc`) — still not started.
3. Phase 6 opens with the restructure commit (compact tree → full tree, pure moves, suite green either side).
