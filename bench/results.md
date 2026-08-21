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

---

# Session 3 — file items, serializer, header experiment

Same machine, Node v22.20.0. Per-scenario durations, as printed by the runner:
hello 10s @ c100/p10; param, chain, notfound, file-1kb 5s @ c100/p10; file-1mb
5s @ c50/p1. Every scenario now asserts its status distribution (the 404
scenario passes only when 404s are 100% of responses), and a sample whose spread
exceeds 5% is re-run up to 5 samples before the median is taken.

## File items (D4) — the priority, and the biggest win of the program

The file-1kb flamegraph found the cost was almost entirely stream/promise
scaffolding wrapped around a 1KB read:

| Frame                | Before | After buffered send | After callback `fs` |
| -------------------- | -----: | ------------------: | ------------------: |
| (garbage collector)  | 20.29% |               6.04% |               2.58% |
| `FastBuffer`         | 13.93% |               1.06% |               1.16% |
| `DOMException`       | 11.13% |                   — |                   — |
| `bind @ async_hooks` |  4.20% |                   — |                   — |
| `stat @ promises`    |  2.28% |               2.37% |               0.26% |
| `open @ promises`    |      — |               2.64% |                   — |

| #   | Change                                                         | Instrument                                                          | Delta                                                                                      | Verdict                  |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| F1  | Buffered send for files ≤ 32KB (`readFile` + one `end`)        | e2e A/B, 5 pairs                                                    | **+98.4%** (11,518 → 22,875 rps; every pair positive, +88.6%..+100.1%)                     | **KEEP**                 |
| F2  | Callback `fs.stat`/`fs.readFile` instead of `node:fs/promises` | e2e inconclusive (+3.98% median, signs disagreed) → self-time share | `stat @ promises` **2.37% → 0.26%**, `open @ promises` wrapper gone, GC **6.04% → 2.58%**  | **KEEP** on self-time    |
| F3  | `highWaterMark` 256KB for streamed files                       | e2e A/B, 5 pairs                                                    | **−7.6%**, every pair negative (−22.1%..−0.0%)                                             | **REVERTED**             |
| F4  | `.pipe()` + manual wiring instead of `pipeline()`              | flamegraph                                                          | pipeline scaffolding ~2.4% of a path that is **23.8% idle** and 25.4% kernel `writeBuffer` | **NOT DONE** — see below |

**F4 was declined on the flamegraph, not on effort.** D4 makes disconnect
tagging and backpressure correctness non-negotiable, and `pipeline()` is what
provides both. The measured ceiling for hand-rolling stream teardown is ~2.4% on
a path that is mostly waiting on the socket. Re-implementing the teardown that
every disconnect guarantee rests on, for that, is a bad trade. Flagged so it can
be overruled.

Disconnect behaviour is unchanged: the streamed path still goes through
`pipeline()`, and the buffered path gained its own disconnect test (client
vanishes before the write lands, ×20, asserting no unhandled rejections and that
anything surfacing is tagged `clientDisconnect`). Threshold tests cover 0 / 1KB /
32KB−1 / 32KB / 32KB+1 / 256KB for byte-exact body and length, and prove the
header set is identical either side of the threshold.

## Serializer (D1) — Option A shipped

`createSerializer(schema)`: closure-composed, char-scan escaping, **no codegen**.
Opt-in — `res.json` is untouched, and a route that never calls it pays nothing.

| Payload                 | `JSON.stringify` | `createSerializer` |   speedup |
| ----------------------- | ---------------: | -----------------: | --------: |
| hello-world             |       14,741,522 |         51,833,345 | **3.52×** |
| api-object (5 fields)   |        4,893,594 |          6,339,908 | **1.30×** |
| nested                  |        4,058,718 |          5,021,270 | **1.24×** |
| list of 20              |          872,967 |            855,308 |     0.98× |
| strings needing escapes |        4,995,474 |          4,830,288 |     0.97× |

Median **1.24×**, and never materially slower — which took two rejected attempts
to reach. A hand-written element loop ran at **0.75×** of `JSON.stringify` on a
20-object list, and collecting-then-joining was worse at **0.54×**: V8's array
path is not beatable from JavaScript without codegen, which is banned. Arrays
therefore delegate wholesale, which is exactly 1.0×, while an array _field_
inside an object still leaves the surrounding object on the fast path.

Parity is the contract, and it is fuzz-enforced. `test/fuzz/serialize.fuzz.ts`
runs 10,000 seeded inputs across 7 schemas — quotes, backslashes, control
characters, astral text, **lone surrogates**, and values that deliberately
violate their schema — asserting byte-equality with `JSON.stringify`, that the
output re-parses, and that escaping stays linear. Failures print `SEED=` for
exact replay.

## Header experiment (D3) — one bounded shot, kept

Batched `res.json`'s two `setHeader` calls into a single `writeHead(status,
headers)`. Judged on self-time share only, as D3 requires:

| Frame            |    Before |     After |
| ---------------- | --------: | --------: |
| `_storeHeader`   |     2.32% |     1.25% |
| `setHeader`      |     1.58% |  — (gone) |
| `writeHead`      |         — |     0.54% |
| **header total** | **3.90%** | **1.79%** |

The share dropped meaningfully, so the change stands; wire output is unchanged.
A follow-on attempt to also drop the `Buffer.from` (send the string, size it with
`Buffer.byteLength`) measured **worse** — framework self-time 3.10% → 3.39% —
and was reverted.

## Final matrix

| Scenario |   zonix | express | fastify | vs express | vs fastify |
| -------- | ------: | ------: | ------: | ---------: | ---------: |
| hello    | 144,250 |  26,731 | 148,800 |       5.4× |      96.9% |
| param    | 140,045 |  26,776 | 147,213 |       5.2× |      95.1% |
| chain    | 139,994 |  26,741 | 146,138 |       5.2× |      95.8% |
| notfound | 137,459 |  23,566 | 139,302 |       5.8× |      98.7% |
| file-1kb |  23,026 |   4,270 |   4,225 |       5.4× |       545% |
| file-1mb |   1,716 |   1,698 |   1,738 |       1.0× |      98.7% |

Read with the noise floor in mind (D2): these are one session's medians, and
spread stayed above 5% for zonix/hello (13.6%) and for every framework's
file-1mb even after 5 samples. **The file-1kb cross-framework figure is unstable
between sessions** — Express measured 14,034 in the previous session and 4,270
here — so the honest claim is the paired one: buffered send took zonix's own
file-1kb from 11,518 to 22,875 rps (+98.4%, every pair positive), clearing
Express's best recorded number of 14,034 outright.

## Exit criteria (revised)

|     | Criterion                                       | Result                                                                          |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| (a) | framework self-time ≤ 2.5% on hello             | **NOT MET — 3.1%** (medians 2.9 / 3.3 / 3.1). See below.                        |
| (b) | chain ≥ 95% of hello, same session              | **MET — 97.0%** (139,994 / 144,250)                                             |
| (c) | file-1kb ≥ Express                              | **MET — 23,026 vs 4,270 this session; also clears the 14,034 recorded earlier** |
| (d) | `createSerializer` + microbench + escaping fuzz | **MET**                                                                         |
| (e) | header experiment run and recorded either way   | **MET — kept, 3.90% → 1.79%**                                                   |
| (f) | no same-session paired regression               | **MET** — the one regression found (F3) was reverted and parity re-confirmed    |
| (g) | results.md documents noise floor + instruments  | **MET**                                                                         |

### Why (a) is not met, and what it is actually measuring

The 3.1% splits as:

| Frame                                       | Share |
| ------------------------------------------- | ----: |
| `json` (JSON.stringify + Buffer.from + end) | 1.94% |
| `ZonixResponse` constructor                 | 0.40% |
| `#handle`                                   | 0.35% |
| `find`                                      | 0.23% |
| everything else                             | 0.17% |

V8 attributes the `JSON.stringify` builtin to its calling frame, so the JSON
encode — work any framework must do — is counted inside `json`. The framework's
own dispatch machinery is **~1.16%**. Getting the total under 2.5% means making
`res.json` faster, and D1 deliberately keeps `res.json` on `JSON.stringify` with
the serializer opt-in; the one legal attempt at the remaining allocation
measured worse and was reverted.

So (a) as written is unreachable without reopening D1. Two honest options:
redefine (a) as **framework dispatch self-time excluding the response encode
≤ 1.5%** (currently ~1.16% ✓), or accept ~3.1% as the floor for `res.json` +
`JSON.stringify` and retire the criterion.

## Open

- Exit (a): redefine or retire (above) — the one thing blocking a clean close.
- F4 (`.pipe()` vs `pipeline()`): declined on flamegraph evidence; overrule if wanted.
- Item 8 (GC audit, `--trace-gc`): still not started.

---

# BI-1 — bench-integrity investigation (CLOSED)

Triggered by rule 6: session 3 recorded Express file-1kb at 4,270 (vs 14,034 the
session before) and Fastify at 4,225 (vs 12,073), collapsing ~68% to within ~1%
of each other while zonix doubled.

**The anomaly was ours, not theirs.** The competitor readings were correct. The
zonix reading in that same matrix was the one taken under different conditions.

## 1. Harness diff vs the previous session's commit

`git diff 40744a4 HEAD -- bench/` — `bench/servers/express.js`,
`bench/servers/fastify.js` and `bench/fixtures.mjs` are **byte-identical**. The
only harness change is `bench/run.mjs` (status assertions, spread-triggered
reruns). No competitor code changed.

## 2. Competitor serving paths verified at runtime

| Framework | Path                                           | Evidence                                                                                                                  |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Express   | `res.sendFile` → `send`                        | `Accept-Ranges: bytes`, `Cache-Control: public, max-age=0`, `Last-Modified`, weak `ETag` all present; 1024 bytes returned |
| Fastify   | `createReadStream` + explicit `content-length` | `content-length: 1024`, 1024 bytes returned                                                                               |

Both still serve through the same mechanism as the prior session, and both are
healthy. Express is doing strictly more work per request (ETag, Last-Modified,
range advertisement) — which explains a gap, but not a session-over-session
collapse.

## 3. Three-way interleaved rerun (`bench/interleave.mjs`, 5 rounds, rotating order)

| file-1kb | median |   min |   max | spread |
| -------- | -----: | ----: | ----: | -----: |
| zonix    |  4,199 | 3,999 | 4,397 |   9.5% |
| express  |  4,252 | 4,235 | 4,270 |   0.8% |
| fastify  |  4,389 | 4,389 | 4,399 |   0.2% |

**zonix collapsed too** — 4,199, against the 23,026 its own sequential matrix
reported minutes earlier. Three very different implementations landing within
4% of each other, at spreads as tight as 0.2%, is the signature of an external
serializing limit rather than of framework code.

Controls that rule out harness and machine-wide causes:

- **Same sequential harness, zonix only, file-1kb, immediately after: 4,198 rps.**
  The harness that produced 23,026 produced 4,198 unchanged. Not a harness defect.
- **hello, interleaved, same period:** zonix 145,779 · express 26,600 · fastify
  150,080 — matching the session-3 matrix (144,250 / 26,731 / 148,800). The
  machine is not throttled; JSON throughput is untouched.

## 4. Environmental cause: `open()` is rate-limited system-wide

Measured outside any HTTP framework (`fsprobe`, 1KB file):

| Operation                                            |             Rate |
| ---------------------------------------------------- | ---------------: |
| `open` + `read` + `close`, project `bench/.fixtures` |   **3,400 /sec** |
| `open` + `read` + `close`, `os.tmpdir`               |   **3,900 /sec** |
| `read` on an already-open fd, project                | **673,664 /sec** |
| `read` on an already-open fd, tmpdir                 | **667,074 /sec** |

Opening a 1KB file costs ~260–290µs; reading the same bytes through an open
descriptor costs ~1.5µs. **The entire cost is in `open()`, it is ~170× the read
cost, and it is not path-specific** — `os.tmpdir` is as slow as the project
directory, so it is not a per-directory exclusion but a system-wide filesystem
filter driver (antivirus real-time scanning) intercepting every open.

Every framework opens the file once per request, so all of them are pinned at
that ~3.4–3.9k opens/sec ceiling: 4,199 / 4,252 / 4,389 is the filter driver
being measured, not zonix, Express or Fastify.

## What this invalidates, and what survives

**Invalidated — the sequential matrix's cross-framework file numbers.** In the
session-3 matrix, zonix was measured first (fast regime, 23,026) and Express and
Fastify later (slow regime, 4,270 / 4,225). The regime changed _during_ the run,
and a framework-by-framework matrix charges that change to whoever was running.
This is exactly the failure rule 6 anticipates. Retired claims:

- ~~file-1kb 23,026 vs Express 4,270 (5.4×)~~ — comparing two different machine regimes.
- ~~"above every Express reading ever recorded"~~ — true in the fast regime only; in the
  current regime nothing exceeds ~4.4k, zonix included.
- Exit (c), "file-1kb ≥ Express", **cannot be adjudicated on this rig**: the metric is
  dominated by a per-open cost shared equally by all three frameworks.

**Survives — the F1 improvement itself.** +98.4% was a _paired_ zonix-vs-zonix
measurement, interleaved in one session, with all five pairs positive
(+88.6%..+100.1%), and it is mechanistically explained by the flamegraph:
buffered send removed GC 20.3% → 2.6%, FastBuffer 13.9% → 1.1% and DOMException
11.1% → 0. What the paired run cannot claim is an absolute rps figure, because
absolute file throughput on this machine depends on which regime it is in.
Stated honestly: **buffered send roughly halves the per-request cost of serving
a small file; on a rig whose `open()` is not filter-driver-bound that showed as
11.5k → 22.9k rps, and on one that is, all frameworks are pinned near the open()
ceiling and the difference is invisible.**

## Standing rules added

- **File scenarios are cross-framework-unusable on this rig.** Any file claim must be
  paired zonix-vs-zonix, and must state that `open()` is the binding constraint.
- **Cross-framework claims use `bench/interleave.mjs`, never the sequential matrix.**
  The sequential matrix measures frameworks in blocks, so any drift lands on one
  framework. Interleaving with rotating order is now the only sound cross-framework
  instrument here.
- Before any file benchmark is believed, run the `open()` probe: if `open+read+close`
  is in the thousands per second rather than the hundreds of thousands, the rig is
  in the slow regime and the numbers describe the filter driver.
- file-1mb remains **permanently low-confidence** (>5% spread at 5 samples in every
  session); no claims are built on it.

---

# Session 4 — regime preflight, the schema question, and the first W2 numbers

## Rule 7 implemented, plus a second preflight it exposed

`bench/regime.mjs` is now imported by `run.mjs`, `interleave.mjs` and `ab.mjs`.

**Filesystem preflight (rule 7).** Before any file scenario the harness measures
`open`+`read`+`close` on the real bench fixture and stamps the run. It also
measures reads through an already-open descriptor, because the _ratio_ is what
distinguishes a filter driver from a merely slow disk — a slow disk makes both
slow, an interceptor only makes `open` slow. Current reading on this machine:

```
regime: DEGRADED-REGIME — 3,489 opens/sec (threshold 50,000),
        602,297 reads/sec on an open fd (173x)
```

So file scenarios remain unadjudicable until the AV exclusion lands.

**CPU preflight (added this session, same rationale).** The first attempt at the
new scenarios ran through the sequential matrix and reported **zonix/hello at
80,787 rps** — against 145,779 measured an hour earlier — with Express down 40%
and Fastify, benchmarked _last_, untouched at 151k. Rule 6 says treat that as a
defect first, and it was one: background agent processes were competing for CPU
during the early part of the run, and a framework-by-framework matrix charges
that to whoever benches during it. The re-run below, interleaved and on a quiet
machine, put hello back at 142,963.

The harness now samples system-wide CPU utilization from `os.cpus()` tick
counters before every run and stamps `BUSY-MACHINE` above 20%. A timed spin loop
was tried first and rejected: on a 24-core machine one spinning thread takes an
idle core and reports 97% of normal while the rest of the machine is saturated.
Verified against a deliberate 4-core load (reads 21.4%, stamps BUSY).

## The Fastify schema question — settled

**`bench/servers/fastify.js` declared no response schema**, confirming the
session-2 suspicion: `fast-json-stringify` has never been active in any matrix
this project has recorded. `bench/servers/fastify-schema.js` now exists, with
response schemas on every JSON route, and both variants are measured below.

**The answer changes the W3 plan: schema compilation is worth ~1% here, not the
gap.** Fastify-with-schema is within noise of Fastify-without on every scenario
(hello 148,544 vs 147,904; routes-200 97,760 vs 96,480; echo 62,890 vs 62,787).
So the earlier hypothesis — that our 95–99% was "us without schema vs them with"
— is false in both directions. Payloads this small do not give a compiled
serializer room to matter, and **D5's route-level `serialized()` wiring should be
expected to buy ~1%, not a category change.** Worth building for the API, not as
a performance play.

## First numbers: routes-200-param and post-json-echo

Interleaved (`bench/interleave.mjs`), rotating order, 5 rounds, one server
process alive at a time, quiet machine. Cross-framework claims come from this
harness only — never the sequential matrix.

| Scenario         |   zonix | express | fastify | fastify-schema | zonix vs fastify | vs express |
| ---------------- | ------: | ------: | ------: | -------------: | ---------------: | ---------: |
| hello            | 142,963 |  26,024 | 147,904 |        148,544 |        **0.97×** |      5.49× |
| routes-200-param | 135,309 |  22,360 |  96,480 |         97,760 |        **1.40×** |      6.05× |
| post-json-echo   |  62,134 |  16,633 |  62,787 |         62,890 |        **0.99×** |      3.74× |

Spreads: 1.2–4.5% everywhere except express/hello (6.1%). Per-round samples are
in the raw output; on routes-200-param the two distributions do not overlap at
all — zonix 132,499–136,614 against fastify 94,355–98,080, five rounds out of
five.

### W2: the router-at-scale win is real

**zonix is 1.40× Fastify and 6.05× Express on a 200-route param-heavy table.**
This is the first decisive cross-framework win the project has that survives its
own rules: above the noise floor, interleaved, non-overlapping distributions,
on a quiet machine, with the status of every response asserted.

The mechanism is visible in how each framework degrades from a 6-route table to
a 200-route one:

|         | 6 routes (hello) | 200 routes |     change |
| ------- | ---------------: | ---------: | ---------: |
| zonix   |          142,963 |    135,309 |  **−5.4%** |
| fastify |          147,904 |     96,480 | **−34.8%** |
| express |           26,024 |     22,360 |     −14.1% |

zonix's radix walk is nearly flat against table size; Fastify loses a third of
its throughput. That is exactly the property the zero-alloc walk and the
segment-keyed tree were built for, and exactly what a 2-route benchmark hides.
**Caveat honestly stated: the cause of Fastify's degradation has not been
profiled** — this records what was measured, not why Fastify behaves that way.
A flamegraph of their router is the next step before any published claim.

The probe deliberately cycles ten paths spread across the table
(`res0`, `res20`, … `res180`). A linear-scan router costs more the later a route
sits, so benchmarking a single position flatters one design or the other;
cycling measures what a real application sees.

### W3: parity, and the gap is not serialization

hello 0.97× and post-json-echo 0.99× are statistical parity — inside the ~5%
noise floor, and now with the schema question closed, not attributable to
serialization on either side.

## Scenario definitions added

- **routes-200-param** — 200 routes of the form `/api/v1/res{i}/:id`, registered
  only when `BENCH_ROUTES=200`, which the runner sets for this scenario alone so
  the small-table scenarios keep the route table their recorded history was
  measured with. Requests cycle ten positions across the table.
- **post-json-echo** — `POST /echo` with a 5-field JSON body, parsed and echoed.
  Body parsing is **route-level** in zonix and Express (`parseJSON()` /
  `express.json()` on the route, never `app.use`): a global parser would take
  every other route off the no-middleware fast path and silently change hello,
  param and chain. Fastify parses JSON itself, so there is nothing to scope.

All four servers were verified to return byte-identical responses on the new
endpoints before any measurement was taken.

---

# W2-V — verification of the routes-200-param win

The Session 5 gate: the 1.40× result may not be published without a named
mechanism, a published scenario spec, a control isolating table size, and
confirmation that the win survives that control. All four are below.

**Verdict: W2-V PASSES, and the claim gets narrower and more accurate.**
The win is real and mechanically explained, but it is _conditional on table
size_: at 6 routes Fastify is slightly ahead, and zonix's advantage only appears
once the table crosses ~50–100 routes.

## 1. Scenario spec (published alongside every use of these numbers)

|                    |                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route shape        | `GET /api/v1/res{i}/:id`, `i` = 0…N−1 — 4 segments, one trailing param                                                                                                                       |
| Registration order | ascending `i`, after the six fixed scenario routes                                                                                                                                           |
| Table sizes        | 6 (control) and 200 (headline); sweep 6→400 in `bench/scaling.mjs`                                                                                                                           |
| Requested paths    | ten positions spread evenly across the table (`res0`, `res20`, … `res180`), cycled by autocannon                                                                                             |
| Why spread         | a linear-scan router costs more the later a route sits; probing one position flatters one design or the other                                                                                |
| Load               | 100 connections, pipelining 10, 5s measured after 2s warmup                                                                                                                                  |
| Method             | `bench/interleave.mjs`, rotating framework order, 5 rounds, median                                                                                                                           |
| Fastify config     | `Fastify({ logger: false })` — `logger: false` is Fastify's own default, so this is a stock instance. No custom router, no `constraints`, no `caseSensitive`/`ignoreTrailingSlash` overrides |
| Versions           | fastify 5.12.1, find-my-way 9.8.0, express 4.21.2, Node v22.20.0                                                                                                                             |
| Handlers           | one closure per route in every framework (symmetric); a shared-closure variant is available via `BENCH_SHARED_HANDLER` and was tested — see below                                            |

## 2. The control: table size isolated

The original comparison divided `routes-200-param` by `hello`, which changes
three variables at once — table size, static-vs-param matching, and path depth
(1 segment vs 4). `routes-6-param` is `routes-200-param` with **only** the table
size changed: same shape, same depth, same param, same probe distribution.

Interleaved, rotating order, 5 rounds, quiet machine (CPU preflight OK):

| Scenario         |   zonix | express | fastify | zonix vs fastify |
| ---------------- | ------: | ------: | ------: | ---------------: |
| routes-6-param   | 117,254 |  22,315 | 120,422 |        **0.97×** |
| routes-200-param | 115,994 |  20,053 |  82,720 |        **1.40×** |

Cost of going 6 → 200 routes, with request type and depth held constant:

|         | 6 routes | 200 routes |     change |
| ------- | -------: | ---------: | ---------: |
| zonix   |  117,254 |    115,994 |  **−1.1%** |
| express |   22,315 |     20,053 |     −10.1% |
| fastify |  120,422 |     82,720 | **−31.3%** |

The earlier headline said Fastify lost 34.8%; with the confound removed it is
**31.3%**. The conclusion is unchanged, and now it is attributable to one
variable.

**At 6 routes Fastify is ahead (zonix 0.97×).** The 1.40× is not a general
routing win — it is entirely the difference in how the two handle a larger
table.

## 3. Mechanism

Flamegraphs of Fastify at both sizes (`npm run profile -- --framework=fastify
--scenario=routes-200-param`):

| Frame                         |  6 routes | 200 routes |
| ----------------------------- | --------: | ---------: |
| `nextTick @ task_queues`      | **0.96%** | **21.94%** |
| `find @ find-my-way/index.js` |     1.20% |      1.40% |
| `writev`                      |    46.37% |     34.84% |
| `(garbage collector)`         |     1.78% |      1.14% |

**The router lookup is not the cost.** find-my-way's `find` is ~1.2–1.4% at both
sizes; the tree walk scales fine. What grows is `process.nextTick`, from 1% to
22% of self time.

Four candidate explanations were tested, and three were falsified:

| Hypothesis                                                           | Test                                                                          | Result                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 200 distinct handler closures make shared call sites megamorphic     | register all scale routes against one shared closure (`BENCH_SHARED_HANDLER`) | **Rejected** — 78,024 rps / 20.03% nextTick vs 78,848 / 20.45%. No change. |
| Cost comes from the variety of paths requested (router cache thrash) | 200 routes, request a **single** path                                         | **Rejected** — 85,056 rps, still ~30% down from the 6-route figure         |
| Schema compilation over 200 routes                                   | fastify vs fastify-schema at 200 routes                                       | **Rejected** — 96,480 vs 97,760, within noise                              |
| GC pressure from a larger live heap                                  | GC self-time at both sizes                                                    | **Rejected** — GC share _falls_, 1.78% → 1.14%                             |

What survives, from `bench/scaling.mjs` (one requested path throughout, so only
the registered count varies):

| framework |       6 |      25 |      50 |        100 |     200 |     400 |
| --------- | ------: | ------: | ------: | ---------: | ------: | ------: |
| fastify   | 120,344 | 125,992 | 125,232 | **87,792** |  82,160 |  82,960 |
| zonix     | 119,160 | 114,032 | 116,472 |    114,240 | 114,848 | 117,424 |

**It is a cliff, not a slope.** Fastify is flat to 50 routes, drops ~30% between
50 and 100, and is flat again to 400. zonix is flat across the whole range.

So the mechanism, stated at the level the evidence supports:

> Fastify pays a per-request cost that scales with the number of routes
> **registered** — not with the number requested, not with the router walk, and
> not with anything the request itself contains. It appears abruptly between 50
> and 100 routes and then plateaus, and it surfaces as `process.nextTick`
> self-time. A step change that then flattens is the signature of a V8
> optimization limit being crossed (an inline cache going megamorphic, or a
> function crossing an inlining budget and being deoptimized) somewhere in
> Fastify's per-request path once the route table is large enough.

**What is not claimed:** the root cause inside Fastify. The falsified list above
rules out the obvious candidates, but identifying the exact call site would take
a V8 deopt trace against Fastify's internals, and a Fastify maintainer would be
better placed to explain it. This is Fastify 5.12.1 on Node 22.20.0; a different
version may behave differently.

**zonix's own property is the publishable half, and it is simple:** per-request
cost is independent of route-table size from 6 to 400 routes (114–119k
throughout). That is what a segment-keyed radix tree with an exact-match map in
front is supposed to give, and it is what it gives.

## 4. The claim, restated for publication

Not "zonix is 1.40× Fastify". The honest form:

> On a 200-route param-heavy table, zonix serves ~1.4× Fastify's throughput
> (115,994 vs 82,720 rps, interleaved, 5 rounds, non-overlapping). At 6 routes
> the two are at parity (0.97×). The difference is table size: zonix's
> per-request cost is flat from 6 to 400 routes, while Fastify's steps down
> ~30% between 50 and 100 routes and stays there. Measured on one machine with
> a ~5% noise floor; the mechanism inside Fastify is characterized but not
> root-caused.

## 5. Note on cross-session drift

`routes-200-param` read zonix 135,309 in the previous session and 115,994 here —
a 14% absolute drift on the same build, on a machine both times stamped CPU-OK.
**The ratio reproduced exactly** (1.40× both times). That is the case for D2 in
one line: ratios within a session are stable, absolutes across sessions are not.

---

# T-0 Turbo spike — official adjudication on the reference rig

_Session 7, Aug 2026. Node 22.20.0, 24 cores, cpu preflight **OK** (5.0–5.9%
system-wide across three samples). Spike code run **unmodified** as delivered in
`bench/servers/spike/`. No file I/O in this scenario, so the `open()` regime does
not apply._

CLAUDE.md M4 records the in-container result (12.63× corked, 1.78× uncorked) and
states plainly that "container absolutes are meaningless", "12.6× is not a
claimable number", and "official adjudication is the same spike re-run, paired,
on the reference rig". This is that run.

## 1. Headline — both configurations clear the kill bar

| Config    | raw `node:http` |     turbo | ratio (median of 5) |  per-pair range | container |
| --------- | --------------: | --------: | ------------------: | --------------: | --------: |
| p=16, C=6 |         150,848 | 1,606,115 |          **10.78×** | 10.37× – 10.84× |    12.63× |
| p=1, C=6  |          84,167 |   144,325 |           **1.71×** |   1.67× – 1.78× |     1.78× |

**The prediction in M4 held.** The transferable signal was named in advance as
the p=1 ratio, and it transferred to within 4% (1.78× → 1.71×) across a 1-core
container and a 24-core workstation. The corked figure fell from 12.63× to
10.78×, exactly as the colocation-amplification caveat predicted. Calling the
p=1 number the real one, before seeing this rig, was the right call.

Raw `node:http` reading 150,848 rps at p=16 is also a useful sanity check: it
sits right where this rig's hello-world numbers live (142–149k for zonix and
Fastify), so the baseline is not a strawman.

## 2. Correctness first — the gauntlet, re-created and re-run

CLAUDE.md records that the spike "passed a 5-test correctness gauntlet" in the
container, but the gauntlet was not delivered with the code. It is now
`bench/servers/spike/gauntlet.mjs`, and it passes **5/5** here:

```
PASS  single request -> 200 with body
PASS  pipelined x3 in one packet -> 3 responses
PASS  byte-dribbled request -> exactly 1 response
PASS  unsupported method -> 405 + close
PASS  oversize headers -> 431 + close
```

This is not ceremony. A server that answers fast but wrongly is not a data
point, and the byte-dribble case in particular is the one that would fail if the
terminator scan mishandled a request split across packets — which would have
made every throughput number above meaningless.

## 3. The finding the container could not have produced: the ratio depends on load shape

Sweeping connection count at p=1 (3 pairs each):

| C   |    raw |   turbo |     ratio |
| --- | -----: | ------: | --------: |
| 1   | 37,896 |  43,896 | **1.16×** |
| 2   | 72,465 | 109,449 |     1.51× |
| 6   | 84,167 | 144,325 |     1.71× |
| 12  | 90,721 | 144,874 |     1.60× |
| 24  | 92,963 | 151,209 |     1.63× |

**At C=1 the spike fails its own kill bar (1.16× < 1.30×).** That is not a
defect in the spike; it is a statement about what Turbo actually buys. With one
connection and no pipelining there is exactly one request in flight, and the
measurement is dominated by loopback round-trip latency that both servers pay
identically. Server CPU is a small slice of that round trip, so saving CPU
barely moves the number.

As concurrency rises the server becomes throughput-bound rather than
latency-bound, per-request CPU starts to dominate, and the ratio expands to its
true value and plateaus around 1.6×.

**So the honest characterization is: Turbo is a throughput win, not a latency
win.** A single sequential client sees ~16%. A loaded server sees ~1.6×. Both
are true; publishing only the second would be the kind of measurement this repo
keeps catching other people making.

## 4. Confirming the load generator is not the ceiling

A single-threaded Node client could easily be the real bottleneck at 150k rps,
which would make every ratio above an artifact. Tested directly by driving one
server with 1, 2 and 3 independent client **processes** and summing:

| clients (C=12 each) | raw `node:http` |   turbo |
| ------------------: | --------------: | ------: |
|                   1 |          90,494 | 139,347 |
|                   2 |          91,744 | 149,584 |
|                   3 |          89,098 | 152,188 |

Raw is flat — it is genuinely server-bound at ~91k. Turbo rises ~9% from one
client to three and then flattens, so a single client mildly understates it; its
true ceiling is ~152k. **Server-bound ceiling to server-bound ceiling: 152,188 /
90,494 = 1.68×**, which agrees with the C=12/C=24 sweep. The single-client
numbers are a floor, not an inflation.

## 5. Verdict

**T-0 PASSES on the reference rig. Turbo lives; the design doc is unlocked.**

The claimable numbers, with their conditions attached:

- **~1.6–1.7× raw `node:http` on throughput**, under concurrency, without
  pipelining. This is the number that should drive the design decision — it is
  pure per-request lifecycle saving (no `IncomingMessage`/`ServerResponse`
  construction, no full header parse, no stream machinery).
- **~10.8× with pipelining depth 16**, which is real but describes a workload
  (deeply pipelined clients) that few production HTTP/1.1 clients generate.
  Never publish it as "Turbo is 10× faster".
- **~1.16× for a single sequential client.** Turbo does not make an idle server
  answer faster.

The production question is unchanged and now has a number attached to it: the
compat shim must retain ≥ 1.2× of the ~1.65× throughput headroom, i.e. the shim
may consume at most ~73% of the saving before Turbo stops being worth its
parsing-surface risk. That is the design doc's budget.

---

# T-1 — the D7 adjudication: Turbo dies

_Session 9, Aug 2026. Node 22.20.0, cpu preflight **OK** (3.7% across 24 cores).
Artifacts in `bench/servers/spike/t1/`: `turbo-t1.mjs` (the transport),
`raw.mjs` / `zonix.mjs` / `fastify.mjs` (baselines), `gauntlet.mjs` (16 checks)
and `smoke.mjs` (baseline body correctness) — the correctness set ran green
BEFORE any number below was read, per the Session 8 standing practice._

## 1. What T-1 measured

The thinnest **end-to-end** Turbo path per the sharpened spec — everything the
T-0 spike skipped is in the measured path:

- **Real parsing with limits**: token-validated method, printable-validated
  target, exact version match, per-header colon split with the
  no-whitespace-before-colon rule, token-validated names, 100-header /
  8KB-line / 16KB-head caps, strict Content-Length digits, duplicate-CL → 400,
  Transfer-Encoding → 501. No terminator-scan shortcut.
- **The head-of-line ordering queue at depth 1**: every request allocates a
  slot; responses emit in request order; corking is opportunistic only.
  The gauntlet proves ordering with a slow-first-request pipeline and proves
  a parse error behind an in-flight response lets it finish first, in order.
- **The documented zonix `res` subset**: chainable validated `status()`,
  `set()`, per-request `json()` (serialize + header build per request — no
  static response buffers; the one cache is the per-second Date string, which
  node:http itself also caches).
- **Dispatch** through the method+path map (zonix's static fast path), 404 on
  miss, sync-throw → 500 + close. Content-Length bodies drained for framing.

Baselines: raw `node:http` kept deliberately maximal (prebuilt body buffers) —
the bar is the best node:http can do, not a strawman. Fastify default config,
plain-callback `reply.send` (no promise tax). zonix from the built dist.
Async bracket: identical `setImmediate` callback mechanism in all four servers.

## 2. The numbers (paired, interleaved, C=6, median of per-round ratios)

**p=1 (judged), 5 rounds:**

| Bracket    |    raw |  zonix | fastify |   turbo |              turbo/raw |          turbo/fastify | turbo/zonix |
| ---------- | -----: | -----: | ------: | ------: | ---------------------: | ---------------------: | ----------: |
| sync-hello | 89,507 | 84,305 |  86,253 | 120,772 | **1.362×** (1.29–1.39) | **1.392×** (1.36–1.42) |      1.408× |
| async-echo | 91,651 | 86,503 |  88,280 | 117,553 |                 1.281× |                 1.329× |      1.349× |

**p=16 (corking bracket, informational, never judged), 3 rounds:**

| Bracket    | turbo/raw | turbo/fastify | turbo/zonix |
| ---------- | --------: | ------------: | ----------: |
| sync-hello |    1.646× |        1.715× |      1.712× |
| async-echo |    1.551× |        1.621× |      1.654× |

## 3. D7 verdict

```
turbo/raw:     1.362x   bar 1.40x   FAILED   (no single pair reached 1.40)
turbo/fastify: 1.392x   bar 1.30x   cleared
ONE BAR MISSED -> TURBO DIES (D7)
```

No re-rolls: the judged configuration (p=1, C=6, sync hello) was fixed in
advance, the median of five paired rounds is the number, and the per-pair
range never touched the bar. Re-running until a 1.40 appeared is exactly the
practice this repo's methodology exists to forbid.

## 4. Why this is a good death, not a wasted session

**The erosion is the finding.** The T-0 spike (no parse, no ordering queue,
static response buffer) measured **1.71×** at p=1. The end-to-end path with
real parsing, HOL ordering and per-request response building measures
**1.36×** — the honest costs ate ~20% of throughput, which is precisely the
question T-1 existed to answer before any hardening investment. TURBO.md's
shim-budget worry was correct; D7's raised bar did its job.

Consistency checks, all coherent: turbo T-1 120,772 vs T-0 spike 144,325
(−16%, the price of real parsing + shim); raw 89,507 here vs 84,167 in T-0
(+6% session drift, cancelled by pairing); the corking bracket confirms
TURBO.md §6's prediction — sync p=16 corks (1.65×), async p=16 loses most of
the corking increment (1.55×), and at p=1 corking never engages at all.

**The claimable residue:** `turbo/zonix = 1.41×` is what a zonix user would
have gained. Per D7's own reasoning, a ~1.4× margin — eroding under noise,
hardware generations and adversarial re-benching — does not justify permanently
owning a security-critical HTTP parser with a smuggling surface and forever
fuzz upkeep. zonix's crown rests on M1–M3 + parity, as D7 said it would.

Turbo is dead. The number is recorded. `bench/servers/spike/t1/` stays in the
tree as the falsification record and as reusable instrumentation.

---

# Session 10 — regime verdict, M3 footprint, upstream drafts

_Node 22.20.0. CPU preflight OK throughout (2.6–8.3% across 24 cores)._

## 1. Regime preflight: the AV exclusion has NOT landed

Three consecutive readings on the bench fixture: **3,897 / 4,617 / 4,506
opens/sec** against the 50,000 threshold — the same ~4k band as every session
since BI-1. Reads on an already-open fd run 123–163× faster, which is the
filter-driver signature, not a slow disk. And it is system-wide, not a
per-directory miss: fixture dir 3,863, repo `bench/` 4,200, `os.tmpdir()`
4,453. **DEGRADED-REGIME stands; W1/M1 file adjudication stays frozen** (fifth
session). Whatever exclusion was added, the filter driver is still
intercepting `open()` everywhere we can reach.

## 2. M3 — footprint & cold start (`bench/startup.mjs`)

Clean installs in `bench/.m3/` (zonix from its own `npm pack` tarball —
`files: ["dist"]` — competitors pinned to the versions every recorded matrix
used). Cold import is the in-process `import()`/`require()` duration, node
boot excluded, median of 10 fresh processes. RSS measured after 10k keep-alive
requests against a minimal hello app, then again after `gc()`.

| framework | install size | files | packages | cold import (median of 10) | RSS after 10k req (gc) |
| --------- | -----------: | ----: | -------: | -------------------------: | ---------------------: |
| zonix     |     116.3 KB |     5 |        1 |                    16.2 ms |                47.1 MB |
| express   |      2.21 MB |   618 |       68 |                    77.5 ms |               100.8 MB |
| fastify   |      7.38 MB | 2,033 |       56 |                    68.8 ms |                56.3 MB |

Margins vs zonix: **express 19.5× bytes / 124× files / 68 packages / 4.8×
import / 2.1× RSS; fastify 65× bytes / 407× files / 56 packages / 4.2× import /
1.20× RSS.** Two runs; medians agreed (import 16.2/19.1, 77.5/79.9, 68.8/67.6
across runs). Per M3's own rule, the small margin is published as plainly as
the large ones: **fastify's steady-state RSS is only 1.20× zonix's** — the
orders of magnitude live in install size and file count, not in resident
memory.

One genuine finding hiding in the max column: on the FIRST-ever import after
install, express read 1,240 ms and fastify 1,487 ms (zonix 21.6 ms) — ~70×
slower than their own warm medians. A second run collapsed both to their
medians. That is the filter driver scanning hundreds of freshly written files
on first touch: **on AV-laden machines the file-count margin becomes a
first-cold-start wall-clock margin.** Recorded as an observation of this rig,
not a general claim.

## 3. The Fastify cliff repro — honest status: not minimal yet

Per the M2 obligation, a self-contained repro was built for the upstream
issue. It does not reproduce the cliff — and finding out why turned into the
session's real work:

- **The recorded instrument still reproduces**: `bench/scaling.mjs` today read
  6→200 routes as 93,424 → 70,896 (**−24%**; recorded −31%). Third session the
  ratio has held.
- **A from-scratch minimal server shows no cliff** (flat to inverted), same
  machine, same load shape, all-200s verified.
- **Paired swap test** (both servers under the same measuring parent,
  interleaved in the same rounds): the bench server's 200/6 ratio sat
  0.24–0.41 _below_ the minimal server's in every round — the trigger is in
  `bench/servers/fastify.js`, not in the harness.
- **Falsified one variable at a time**: handler style (async return vs
  `reply.send`), the six fixed routes registered ahead of the scale table, a
  shared `{}` options object. None flipped the minimal server.
- **Machine caveat, recorded per rule 6**: socket benches today wobbled up to
  ~40% intra-config (norm ~5%) with the CPU preflight green throughout — a
  preflight blind spot (it sees CPU, not whatever this was). Today's
  falsifications are therefore lower-confidence, and isolation restarts on a
  quiet machine before any filing.

Both upstream drafts are written (`upstream/fastify-cliff/ISSUE.md`,
`upstream/express-docs/PR.md`). The Express one is **ready to file** —
`type-is@1.6.18` and `@2.1.0` verified directly, plus the wire test against
express@4.22.2; docs source files located in `expressjs/expressjs.com` `main`.
The Fastify one is **blocked on its own minimal repro**, by its own stated
definition of ready.

---

# Session 12 — two-machines diagnosis, detector port, and the Fastify isolation's twist

_Node 22.20.0, cpu preflight OK (2.6–4.3%) throughout; socket-bench spread
gate 9.9% at the isolation's start._

## 1. Diagnosis: the harness context is native win32, and it sees no exclusion

Rule-7 fingerprint from inside this session's context: **win32 10.0.26200,
node v22.20.0, `C:\Program Files\nodejs\node.exe`, cwd on `C:\`** — NOT WSL;
the bridge hypothesis is dead. The in-context differential: repo 3,781–4,305
opens/sec @ 74–166×, `%TEMP%` 4,657–4,710 @ 67–72× — **no differential, both
degraded**, and identical with the tool sandbox disabled. Defender: RTP on,
**Tamper Protection ON**, exclusion list admin-only. The machine rebooted
today 13:36. Remaining fork — exclusion reverted (for everyone) vs
process-scoped — decided by Swapnil re-running `probe.cjs` interactively:
still ~48k → process-scoped; ~4k → reverted (Tamper Protection or the reboot).

## 2. Detector port (committed 583d72c)

`bench/regime-constants.cjs` is now the ONE copy of the thresholds (degraded =
opens < 20,000/sec OR ratio > 40×; both lines mid-gap between the two measured
regimes). `regime.mjs` and `probe.cjs` share it; every reading carries its
execution-context fingerprint; `run/interleave/ab` all run the check pre AND
post with REGIME-FLIP voiding.

## 3. The Fastify isolation: minimal repro found — and then the finding changed shape

Strip-isolation from the reproducing side (variants in
`upstream/fastify-cliff/variants/`, driver `strip.mjs`):

- **A** (verbatim bench server): cliffs — 0.766/0.836/0.733.
- **B** (fixtures/file routes removed): cliffs.
- **C** (scale routes ONLY): cliffs — 0.788–0.881, 4/4.
- **D** (true minimal: inline loop, no schemas, no shared.mjs): **cliffs —
  0.750–0.852, 4/4.**
- **E** (D with `reply.send` callbacks): cliffs — 0.711–0.792, 4/4.

So every prior "trigger ingredient" hypothesis was wrong: **the minimal repro
is just `Fastify({logger:false})` + N async param routes**, and the morning's
flat readings were the pre-reboot machine state (the 13:36 reboot separates
them). `repro.mjs` finalized as the self-contained deliverable (interleaved,
status-asserted, order-configurable).

**Then the twist.** Within the same afternoon, the finalized repro read 200
routes **+14–21% FASTER** (3/3 rounds) — and an order-reversal test proved it
is not positional: 200r was faster measured first (+27%) AND second (+21%),
while an hour earlier it was slower in 8/8 round-pairs. **The sign of
Fastify's table-size effect flips with machine state.** Absolute bands
correlate: cliff windows have 6r at 64–95k (all three recorded sessions were
in this band); inverted windows at 53–65k.

**The control that keeps the claim honest: zonix, measured in the same
states, both orders — 0.970 and 1.010. Flat. Always.** Today did not weaken
zonix's half of W2; it strengthened it (flat through machine states that swing
Fastify ±25%). What it changed is the Fastify half: "loses ~30% at a cliff"
is now known to be **state-dependent on this rig**, and the upstream issue
must say so — a maintainer on a different machine might see +20% and
reasonably call the report wrong.

**Filing bar updated accordingly:** the repro is minimal and self-contained,
but filing waits for reproduction on a second machine (or a characterized
stable window), with the state-dependence stated in the issue text. W2's
publication wording inherits the same caveat — Swapnil's call.

---

# Session 13 — D8 executed: the container is the courtroom

_Host: win32, cpu preflight OK (8.2%). Container: `zonix-bench` from
`bench/Dockerfile` — node:22.20.0-bookworm-slim, repo COPIED in, `--cpus=8`.
Container fingerprint: linux 6.6.87.2-microsoft-standard-WSL2, node v22.20.0,
cwd /zonix, exe /usr/local/bin/node._

## 1. The container is clean by construction

Entry probe, every run: **582–620k opens/sec @ 5.4–5.9×** (repo and /tmp
alike). The host context reads ~4k @ ~125×. That is a ~140× difference in
`open()` cost between courtrooms on the same physical machine — the number
six sessions of frozen file work were waiting for. The in-harness reading
(`measureRegime` inside interleave) was 305,635 @ 9.2× — clean, and the
post-check agreed: **no flip**.

## 2. Exit (c), adjudicated at last — file-1kb, paired, rotating order, 5 rounds

| framework |     median |    min |    max | spread |
| --------- | ---------: | -----: | -----: | -----: |
| zonix     | **12,370** | 12,252 | 12,724 |   3.8% |
| express   |      7,117 |  6,974 |  7,194 |   3.1% |
| fastify   |      8,647 |  8,222 |  8,808 |   6.8% |

**zonix 1.74× Express · 1.43× Fastify.** Regime OK pre and post, no
REGIME-FLIP, every spread inside tolerance. **Exit (c) — "file-1kb ≥
Express, plain e2e, under a passing regime preflight" — is MET**, and not
narrowly. Mechanism is the one already proven paired on the host (F1:
buffered ≤32KB send vs stream-per-request). Absolutes are container
absolutes (8 CPUs, autocannon in the same VM) — the ratio is the claim.

## 3. The Fastify repro in the second environment — and what it actually is

Rule 9 required a second environment for a sign-sensitive claim. Two windows,
separated by the exit-(c) run, each with `repro.mjs` (6 vs 200, interleaved,
fresh process per run) and the zonix flat-control in both orders:

| window            | fastify 6r (per round)   | fastify 200r (per round) | 200/6 | zonix 200/6 (both orders) |
| ----------------- | ------------------------ | ------------------------ | ----: | ------------------------- |
| 1                 | 109k, 100k, 104k         | 105k, 104k, 102k         | 0.998 | 1.012 / 0.982             |
| 2                 | 106k, **166k**, **163k** | 107k, 111k, 108k         | 0.665 | 1.007 / 0.973             |
| 6-round follow-up | 104–108k ×6              | 104–108k ×6              | 0.996 | —                         |

**The reframing, and it explains four sessions of contradictions.** Fastify's
per-process throughput is **bimodal**. At 200 routes every process — 12 of
12 in the container, all recorded host sessions — ran at the common mode
(~105k here, ~82k on the host). At 6 routes, a process sometimes lands in a
**fast mode ~55% higher** (2 of 12 here; the default on the host in
fast-machine bands, where all three recorded sessions sat). There is no
per-request cost that grows with table size; there is a fast mode that small
tables sometimes reach and large tables were never observed to reach.

Everything fits now: the recorded "−30% cliff" = fast-mode-6 vs common-200;
the host's "inversions" = common-mode-6 vs common-200 under slow-band noise;
"flat" windows = common-mode-6 vs common-200 on a quiet machine; the profile
signature (`nextTick` 1% → 22%) = a fast-mode 6-route profile against a
common-mode 200-route profile. And zonix: **141–150k, 0.97–1.01 in both
windows, both orders — no modes, no cliff, no noise story**.

**Publication consequences:** the W2 wording "Fastify loses ~30% at a cliff"
is retired. The accurate statement: _zonix is flat 6→400 routes in every
environment and state measured; Fastify has a higher-throughput mode that was
only ever observed with small route tables._ Filable upstream with the
bimodal framing once the fast-mode rate is quantified (cheap: `ROUNDS=20
repro.mjs 6 200` in the container) — Swapnil's call.

**Container vs host, for the record:** in the container zonix leads Fastify
at both sizes (1.36× at 6 routes vs common-mode Fastify, 1.34× at 200);
on the host the 6-route comparison met fast-mode Fastify (0.97×). Same
build, different mode availability — another reason absolutes are never the
claim.

---

# Session 14 — fast-mode frequency sampling (container, ROUNDS=20)

_Container `zonix-bench`, `--cpus=8`, regime clean on entry. `ROUNDS=20
repro.mjs 6 200`: 20 fresh 6-route processes and 20 fresh 200-route
processes, interleaved._

|            | fast-mode processes | common-mode range |  median |
| ---------- | ------------------: | ----------------: | ------: |
| 6 routes   |          **0 / 20** |    99.9k – 110.4k | 105,216 |
| 200 routes |          **0 / 20** |    96.3k – 109.5k | 105,600 |

Per-round 200/6 ratios 0.932–1.062, median **1.004** — flat. Cumulative
container tally across sessions 13–14: **6-route processes in the fast mode
2 of 32; 200-route processes 0 of 32.** The fast mode (~165k) is real —
two processes reached it in session 13 — but at ~6% per process in this
environment it is rare, and this sample did not catch one.

What this means for the claim: the bimodal framing stands (the fast mode has
been observed only with the small table, in both environments), but the
container cannot yet say whether 0/32 at 200 routes is "never" or "rare
too". The host, where the fast mode was the default for small tables across
three sessions, is the stronger place to count — once it is quiet. The
upstream issue should state the rate honestly: _observed 2/32 vs 0/32 in the
container; the default vs never observed on the host_.

---

# Full matrix 2026-08-22 (container)

_The first complete fresh matrix in the D8 courtroom: every scenario, all
three frameworks, one session. Harness: `bench/matrix.mjs` via
`node bench/container.mjs --cpus=8 --abort-busy -- node bench/matrix.mjs --rounds=5`.
Rotating framework order every round; one fresh process per measurement;
1 warmup (2s) + 5s measured; ≥5 rounds, extended to 8 while any framework's
spread exceeded 5%; median reported; every scenario asserts its expected
status (404 scenario: 404 == 100% of responses); regime checked pre AND
post. **Ratios are the claim. Container absolutes are never compared with the
host-era table — different courtroom.**_

**Host preflight:** cpu OK — 5.1% system-wide across 24 cores.
**Container entry probe:** repo 574,063 opens/sec @ 5.0×, `/tmp` 607,737 @
4.9× → REGIME CLEAN. In-harness: cpu OK — 0.1%.

```
context: linux 6.6.87.2-microsoft-standard-WSL2 node v22.20.0
  cwd /zonix
  tmp /tmp
  exe /usr/local/bin/node
regime pre:  OK — 314,755 opens/sec, 2,379,025 fd-reads/sec (7.6x)
regime post: OK — 295,011 opens/sec, 2,792,064 fd-reads/sec (9.5x) -> no flip; file numbers stand
node v22.20.0 · container cpus=8 · image node:22.20.0-bookworm-slim · repo copied in
```

| scenario                 | zonix rps | express rps | fastify rps | zonix/express | zonix/fastify |   spread% (z/e/f) | rounds |
| ------------------------ | --------: | ----------: | ----------: | ------------: | ------------: | ----------------: | -----: |
| hello                    |   162,227 |      28,042 |     174,758 |         5.79× |         0.93× |   7.3 / 4.6 / 7.8 |      8 |
| routes-6-param           |   148,877 |      26,925 |     162,061 |         5.53× |         0.92× | 12.0 / 4.2 / 12.7 |      8 |
| routes-200-param         |   145,651 |      23,046 |     108,186 |         6.32× |         1.35× |  11.5 / 8.8 / 4.1 |      8 |
| chain                    |   152,051 |      27,866 |     169,587 |         5.46× |         0.90× |  15.8 / 4.4 / 8.9 |      8 |
| 404                      |   153,152 |      27,736 |     155,533 |         5.52× |         0.98× |   3.1 / 4.2 / 3.2 |      5 |
| post-json-echo           |    47,466 |      15,345 |      50,544 |         3.09× |         0.94× |   4.9 / 3.1 / 3.5 |      5 |
| file-1kb                 |    12,710 |       7,100 |       8,712 |         1.79× |         1.46× |   3.4 / 3.7 / 4.3 |      5 |
| file-1mb (informational) |     1,441 |       1,320 |       1,536 |         1.09× |         0.94× |   6.8 / 2.1 / 7.3 |      8 |

### Per-round values (fastify in full; zonix alongside as the rule-9 flat control)

| scenario         | fastify rounds                                                         | fastify split | zonix rounds                                                           | express rounds                                                 |
| ---------------- | ---------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| hello            | 178,624, 175,834, 174,707, 174,810, 173,811, 175,578, 171,379, 164,954 | unimodal      | 162,675, 161,779, 169,613, 164,672, 157,837, 167,027, 160,678, 161,114 | 28,706, 28,587, 27,816, 28,062, 28,376, 28,021, 27,410, 27,448 |
| routes-6-param   | 163,290, 146,291, 160,576, 166,874, 157,914, 163,981, 160,832, 163,290 | unimodal      | 151,846, 134,445, 147,904, 143,450, 150,182, 149,850, 147,008, 152,384 | 27,077, 26,891, 27,096, 26,958, 25,963, 26,562, 26,846, 27,070 |
| routes-200-param | 107,168, 104,826, 108,205, 107,104, 108,794, 108,166, 108,922, 109,229 | unimodal      | 146,701, 149,261, 143,194, 138,586, 148,826, 144,602, 132,506, 149,312 | 23,438, 22,894, 23,243, 22,459, 22,670, 23,198, 21,416, 23,397 |
| chain            | 172,838, 171,610, 172,403, 169,664, 169,203, 157,709, 159,066, 169,510 | unimodal      | 158,298, 155,482, 156,582, 154,355, 146,803, 134,253, 145,395, 149,747 | 27,538, 28,258, 28,200, 28,149, 28,158, 27,077, 27,029, 27,582 |
| 404              | 158,272, 155,354, 155,533, 153,254, 155,533                            | unimodal      | 154,893, 153,331, 153,024, 153,152, 150,080                            | 27,845, 27,915, 26,754, 27,250, 27,736                         |
| post-json-echo   | 50,563, 51,280, 50,544, 49,533, 49,802                                 | unimodal      | 46,275, 47,466, 48,598, 48,483, 47,082                                 | 15,591, 15,693, 15,345, 15,214, 15,246                         |
| file-1kb         | 8,712, 9,012, 8,700, 8,716, 8,639                                      | unimodal      | 12,814, 12,710, 12,623, 12,740, 12,385                                 | 7,160, 7,105, 7,059, 7,100, 6,895                              |
| file-1mb         | 1,585, 1,560, 1,541, 1,523, 1,541, 1,532, 1,473, 1,520                 | unimodal      | 1,458, 1,439, 1,372, 1,471, 1,458, 1,426, 1,443, 1,411                 | 1,328, 1,317, 1,322, 1,300, 1,324, 1,325, 1,302, 1,302         |

### Reading it honestly

- **Within this session every Fastify scenario is unimodal — but the session
  as a whole shows both modes.** Small tables (hello, routes-6, chain) ran
  **16/16 processes in the fast band** (~165–178k); routes-200 ran **8/8 in the
  common band** (~108k). Sessions 13–14 saw the opposite frequency in this same
  container (2/32 fast at 6 routes). So the fast mode is not rare in the
  container after all — its availability varies _per session_, and in every
  session yet recorded, in both environments, **200-route processes have never
  been observed in it (now 0/40 container, 0/all host)**. The bimodal framing
  stands and strengthens; the "rare" qualifier from Session 14 is withdrawn.
- **zonix, the flat control: 6→200 routes costs 2.2%** (148,877 → 145,651,
  inside its own spread); Fastify fast-6 → common-200 is −33%. Same shape as
  every prior window: 1.35× at 200, 0.92× at 6.
- **Ratios vs prior container readings hold within noise** (file-1kb 1.79× /
  1.46× vs Session 13's 1.74× / 1.43×) even though every absolute in this run
  is higher than Session 13's (Express 28k vs earlier ~26k-class; zonix hello
  162k vs 141–150k) — the VM itself was in a faster band. Absolutes: never the
  claim.
- **Spread breaches, logged:** zonix exceeded 5% on hello (7.3%), routes-6
  (12.0%), routes-200 (11.5%) and chain (15.8%) even after extending to 8
  rounds; each is a single low round (e.g. chain round 6 134k, routes-200
  round 7 132k) in an otherwise tight band, and Fastify shows the same
  single-round dips (hello r8, routes-6 r2, chain r6–7). Medians stand;
  the ±5% floor applies to the small-scenario ratios as always. file-1mb
  remains informational (7% spread, kernel-bound).
- **404 scenario:** 404 == 100% asserted in every process. Express emitted
  `MaxListenersExceededWarning: 11 close listeners added to [Socket]` on this
  path under pipelining 10 (source not investigated); it is Express's own
  warning, recorded here so nobody mistakes it for ours.
- **Standing after this matrix (container, same-session):** parity band
  0.90–0.98× Fastify on the micro JSON scenarios (hello/6-param/chain/404/echo),
  5.5–6.3× Express; **1.35× Fastify at 200 routes; 1.46× Fastify and 1.79×
  Express on file-1kb.** Footprint table (M3) unchanged.
