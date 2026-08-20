# Benchmark results

Committed history. Every Phase 5.5 optimization is recorded here with the number
that justified keeping or reverting it.

## Environment

|         |                                                                             |
| ------- | --------------------------------------------------------------------------- |
| Machine | Windows 11 Pro 26200, i-series laptop (developer workstation, not isolated) |
| Node    | v22.20.0                                                                    |
| Load    | `autocannon`, per-scenario settings in `bench/run.mjs`                      |
| Method  | 1 warmup run + 3 measured runs, **median** reported                         |

## Methodology, and its limits

The locked method (1 warmup + 3 measured, median) is what `npm run bench`
produces. Two measurement findings shaped everything below, and both are
reproducible:

**1. The end-to-end noise floor on this machine is ~5%.** Measured by A/B-ing a
build against _itself_. Four harness designs were tried:

| Harness                               | Identical-build result                                      |
| ------------------------------------- | ----------------------------------------------------------- |
| Sequential full matrix, 3 runs        | fastify drifted 126.6k → 153.4k rps between sessions (+21%) |
| `ab.mjs`, alternating, `-c 100 -p 10` | paired deltas −18.0%..+13.5%                                |
| `ab.mjs`, alternating, `-c 20 -p 1`   | paired deltas −4.7%..+4.6%                                  |
| Cross-process microbench              | per-case swings ±15%                                        |

**2. zonix's own code is a small share of a request.** From `npm run profile`
(v1 baseline): `writev` alone is 45% of self time, and everything zonix
executes is **3.9%** (hello), **6.4%** (param), **9.1%** (chain).

Together these mean the spec's "< 1% on its target scenario gets reverted" rule
**cannot be adjudicated end-to-end on this machine** for router-level changes:
the whole subsystem is smaller than the noise. Three instruments are therefore
used, and each optimization is recorded with the one that can actually resolve
it:

- **`bench/micro-ab.mjs`** — one router implementation per process (keeps the
  measured call site monomorphic), alternating baseline/candidate processes,
  median of paired deltas. Resolves the router walk directly.
- **Profile self-time share** — a ratio _within_ one run, so machine drift
  cancels. Used for chain/dispatch changes.
- **`bench/ab.mjs`** — end-to-end, alternating. Trustworthy only when every
  paired run agrees in sign.

Absolute cross-session rps must not be compared. Ratios within one session can.

## v1 baseline (before Phase 5.5)

| Scenario |   zonix | express | fastify |
| -------- | ------: | ------: | ------: |
| hello    | 136,826 |  22,971 | 126,647 |
| param    | 127,578 |  23,016 | 127,667 |
| chain    | 117,869 |  22,328 | 121,568 |
| notfound | 117,011 |  20,635 | 117,395 |
| file-1kb |  11,345 |  12,740 |  10,910 |
| file-1mb |   1,480 |   1,589 |   1,529 |

## Phase 5.5 step 2 — optimization log

| #   | Change                                      | Instrument                                          | Delta                                                                                                                                                                                 | Verdict                                                                                                                                                                                                                               |
| --- | ------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Content-Length` on `res.json`              | `curl -v` on all three response paths               | —                                                                                                                                                                                     | **Already done in v1.** No response is chunked; `res.json`, the default 404 and `sendFile` all set a byte-exact `Content-Length`. No code change.                                                                                     |
| 2   | O(1) static-route map before the radix walk | code review + `curl`                                | —                                                                                                                                                                                     | **Already done in v1** (`tree.exact`). A single combined `METHOD:path` key was considered and rejected: it needs a string concat + hash of a longer key per request, versus two `Map.get` calls on strings that are already interned. |
| 3   | Precomposed per-route pipeline              | profile share + end-to-end A/B (chain)              | `#runChain` self time **4.91% → 1.45%**; total zonix frames 9.1% → 5.8%; end-to-end **+5.04%** (5/5 pairs positive, +2.7%..+6.4%)                                                     | **KEEP**                                                                                                                                                                                                                              |
| 4   | Uppercase method keys                       | `micro-ab`, 7 pairs                                 | static lookups **+114%** / **+101%** (all pairs positive); projected end-to-end ~+0.3–0.5%                                                                                            | **KEEP** — see note below                                                                                                                                                                                                             |
| 5   | Zero-alloc URL walk                         | `micro-ab`, 7 pairs                                 | param cases **+29–39%**, miss **+47%**, trailing-slash **+28%** (ranges entirely positive); static & encoded unchanged as expected; wildcard **−4%**; projected end-to-end ~+0.2–0.3% | **KEEP** — see note below                                                                                                                                                                                                             |
| 6   | Sync completion path                        | profile share + end-to-end A/B (chain)              | zonix frames **5.8% → 3.4%**, `#runChain` frame gone; end-to-end **+6.46%** (5/5 pairs positive, +2.4%..+9.8%)                                                                        | **KEEP**                                                                                                                                                                                                                              |
| 7   | Schema serializer                           | measured, **not implemented** — awaiting a decision | see below                                                                                                                                                                             | **BLOCKED on Swapnil**                                                                                                                                                                                                                |
| 8   | GC audit                                    | not started                                         | —                                                                                                                                                                                     | pending                                                                                                                                                                                                                               |

### Note on items 4 and 5 — a deliberate deviation from the revert rule

Both win large multiples on the code they target and both project to **under 1%
end-to-end**, because the entire router is ~1% of a request. Read literally, the
rule reverts them. They were kept because:

- The rule's stated purpose is _"complexity has a budget"_. Item 4 spends none —
  it deletes a per-request `toLowerCase()` allocation and is strictly less code
  on the hot path. Item 5 spends ~45 lines for +29% on every param match.
- The end-to-end harness under-represents routing: its table has 6 shallow
  routes. `micro.ts` uses an 18-route table with realistic depth, where routing
  is a larger share of the request.

Flagged rather than assumed: **if Swapnil reads the rule strictly, item 5 is the
one to revert** (item 4 is free).

### Scenario ratios — the drift-free view of Phase 5.5

Each scenario as a percentage of _the same session's_ hello-world number, so
machine drift cancels. Items 3 and 6 target exactly the middleware chain:

| Scenario | v1 baseline | after items 1–6 |      change |
| -------- | ----------: | --------------: | ----------: |
| param    |       93.2% |           97.5% |  **+4.3pp** |
| chain    |       86.1% |           98.2% | **+12.0pp** |
| notfound |       85.5% |           94.9% |  **+9.4pp** |

## After items 1–6

| Scenario |   zonix | express | fastify | zonix vs fastify |
| -------- | ------: | ------: | ------: | ---------------: |
| hello    | 136,663 |  23,071 | 153,382 |            89.1% |
| param    | 133,280 |  23,870 | 152,102 |            87.6% |
| chain    | 134,150 |  24,270 | 149,261 |            89.9% |
| notfound | 129,664 |  22,542 | 141,222 |            91.8% |
| file-1kb |  11,815 |  14,034 |  12,073 |            97.9% |
| file-1mb |   1,596 |   1,778 |   1,682 |            94.9% |

**The Phase 5.5 exit bar (≥ 95% of Fastify on hello-world) is not met and is not
currently measurable.** In this session zonix is at 89.1%; in the baseline
session the same build measured 108% because fastify happened to run 21% slower.
Neither number should be quoted. Certifying a 95% bar needs a quiet, dedicated
machine — see "Open" below.

No scenario regressed: every measured item improved or held, and the chain,
param and notfound ratios all rose.

## Item 7 — serializer, measured before deciding

`res.json`'s entire cost — `JSON.stringify` + `Buffer.from` + two `setHeader`
calls + `end` — is **2.15% of self time** on hello-world (`JSON.stringify` is not
a separate frame; V8 attributes the builtin to its caller). That is the whole
budget item 7 can compete for.

Prototypes of both options, measured (1M iterations × 7 batches, median ops/s):

| Payload            | `JSON.stringify` | A, naive escape | A, tuned escape | B, codegen + tuned | A' vs base | B vs base |
| ------------------ | ---------------: | --------------: | --------------: | -----------------: | ---------: | --------: |
| `{hello:"world"}`  |       14,725,112 |      19,686,396 |      47,083,418 |         55,210,185 |  **3.20×** | **3.75×** |
| 5-field API object |        5,166,634 |       4,846,690 |       6,405,456 |          9,826,793 |  **1.24×** | **1.90×** |

Findings that bear on the decision:

1. **Most of the win is the escaping technique, not the codegen.** A naive
   closure serializer is _slower_ than `JSON.stringify` on a realistic payload
   (0.94×). Adding a linear char-scan escape that quotes clean strings directly
   takes the same closure design to 1.24–3.20×. Option A gets that too.
2. **Option B's remaining edge over a tuned Option A is 1.17× (tiny) to 1.53×
   (typical)** — real, but a fraction of a 2.15% budget: roughly **+0.3–0.8%
   end-to-end**, which is inside this machine's noise and, by the project's own
   rule, not enough to buy a ban exception.
3. **Neither option closes the Fastify gap.** Even an infinitely fast serializer
   returns at most ~2.2% on hello-world. The remaining gap is in Node's own
   header machinery (`_storeHeader` 2.3%, `setHeader` 1.6%) and `writev` (46%),
   not in serialization.

## Open

- Item 7 decision (Option A vs B) — blocked on Swapnil.
- Item 8 (GC audit, `--trace-gc`) — not started.
- A quiet machine (or a CI runner with fewer background processes) is needed
  before the ≥95%-of-Fastify exit bar can be certified either way.
