# DRAFT — Fastify issue: throughput drops ~30% once the route table crosses ~50–100 routes

> **Status: NOT FILABLE AS A TABLE-SIZE ISSUE (2026-08-22, post-audit
> session) — the minimal repro does not reproduce a table-size effect.**
> `ROUNDS=20 repro.mjs 6 200` in the pinned container: the fast mode (~165k)
> was reached by **8/20 six-route processes and 9/20 two-hundred-route
> processes** — same rate, independent of table size; a per-process,
> per-session lottery (Session 14 read 0/20 + 0/20 in the same container).
> The earlier "never observed with ~200 routes" statement is **withdrawn**.
> What remains is narrower: in _our full bench server_
> (`bench/servers/fastify.js`) the 200-route configuration has read the
> common band in 13/13 container processes while the 6-route configuration
> read the fast band 16/16 in the same matrices — a ~0.03% coincidence at
> a 45% lottery rate, so that effect is real but belongs to that server's
> construction at 200 routes, not to Fastify + 200 routes in general.
> **Before anything is filed:** a V8-level explanation (`--trace-deopt` /
> `--trace-ic` of the bench server at 6 vs 200 routes) that names what denies
> the fast mode. Without a mechanism there is nothing to ask upstream to fix.
> The bimodal per-process throughput itself (fast vs common, ~55% apart, same
> code, same table) may be worth a separate, smaller report once its trigger
> is understood. Swapnil decides.

## Proposed title (to be rewritten in the bimodal framing)

Old: `Per-request throughput drops ~30% when the number of registered routes crosses ~50–100, then plateaus`

New (draft, superseded 2026-08-22): ~~`A ~55%-faster per-process throughput mode is reachable with a small route table but never observed with ~200 routes`~~ — falsified by ROUNDS=20 (9/20 fast at 200 routes). No title until a mechanism exists.

## Proposed body (evidence from the recorded harness)

While benchmarking routing at realistic table sizes we found that Fastify's
per-request cost appears to depend on how many routes are **registered** — not
on which routes are requested, and not on the router walk itself.

**Setup:** Fastify 5.12.1 (find-my-way 9.8.0), Node v22.20.0, stock
`Fastify({ logger: false })`, no schemas, no constraints. Routes are
`GET /api/v1/res{i}/:id` — four segments, one trailing param, one `async`
handler closure per route returning `{ id: req.params.id }`. Load is
autocannon, 100 connections, pipelining 10, 5s measured after 2s warmup, a
fresh server process per table size. **One requested path throughout**
(`/api/v1/res0/12345`), so the router walk is held constant while the table
grows.

Throughput vs routes registered (median, interleaved rounds):

| routes registered |       6 |      25 |      50 |        100 |    200 |    400 |
| ----------------- | ------: | ------: | ------: | ---------: | -----: | -----: |
| req/s             | 120,344 | 125,992 | 125,232 | **87,792** | 82,160 | 82,960 |

It is a **cliff, not a slope**: flat to 50 routes, −30% between 50 and 100,
flat again to 400. (Re-verified on the same machine the day of this draft:
93,424 → 70,896 across 6 → 200 routes, −24% — absolute numbers drift between
sessions, the ratio does not.)

**Profiles say the router lookup is not the cost.** Comparing CPU profiles at
6 and 200 routes:

| frame                | 6 routes | 200 routes |
| -------------------- | -------: | ---------: |
| `find` (find-my-way) |    1.20% |      1.40% |
| `process.nextTick`   |    0.96% |     21.94% |
| `writev`             |   46.37% |     34.84% |
| garbage collector    |    1.78% |      1.14% |

`find` stays flat — the radix walk scales fine. What grows is
`process.nextTick`, from ~1% to ~22% of self time.

**Hypotheses we tested and rejected:**

| hypothesis                                             | test                                            | result                                        |
| ------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------- |
| 200 distinct handler closures → megamorphic call sites | register every route against ONE shared closure | rejected — no change (78,024 vs 78,848 req/s) |
| requested-path variety (cache thrash)                  | 200 routes, request a single path               | rejected — still ~30% down                    |
| schema compilation across 200 routes                   | schema vs no-schema variants at 200 routes      | rejected — within noise                       |
| GC pressure from a larger heap                         | GC self-time at both sizes                      | rejected — GC share _falls_ (1.78% → 1.14%)   |

A step change that then plateaus, surfacing as `nextTick` growth, looks like a
V8 optimization threshold being crossed by some per-route internal structure
once the table is large enough (an inline cache going megamorphic, or an
inlining budget being exceeded, somewhere in the request path). We have not
root-caused it inside Fastify — a `--trace-deopt`/`--trace-ic` pass against
your internals would be the next step, and you are better placed to read it.

Happy to run anything you want on our rig; harness and raw data are published
at <repo link>.

## Why this is not filed yet (internal status — remove before filing, updated Session 12)

**Superseded by Session 12:** the section below documented the search for the
minimal repro; that search is over — `repro.mjs` (bare Fastify + N param
routes) cliffs, and every "trigger ingredient" hypothesis proved wrong (the
morning's flat readings were a sick machine, separated from the afternoon's
16/16 cliffing rounds by a reboot). The remaining blocker is different: the
same repro, same machine, later windows, reads the effect INVERTED — and a
zonix control is flat through every window. Sign-flipping with machine state
means single-machine evidence is not filable. Needed: reproduction on a
second machine, and the state-dependence in the issue text.

### Original isolation notes (historical)

The paragraph above cites our full harness (`bench/scaling.mjs` spawning
`bench/servers/fastify.js`). A **from-scratch minimal server does not show the
effect** — flat-to-inverted on the same machine, same day — so the trigger is
some ingredient of `bench/servers/fastify.js` that the minimal file lacks. A
paired swap test (both servers measured by the same parent, interleaved in the
same rounds) confirms the difference tracks the server file, not the
measurement context.

Falsified as the trigger, one variable at a time: **handler style** (async
return vs `reply.send` callback — both flat standalone), **the six-route fixed
mix** registered before the scale routes (incl. a POST route and a
hook-carrying route), and **a shared `{}` route-options object**. Remaining
candidates are diffed in `repro.mjs`'s header.

Complication recorded honestly: the isolation ran on a day the machine showed
~40% intra-config spread on socket benchmarks (this rig's documented norm is
~5%), with the CPU preflight green throughout — so today's falsifications are
lower-confidence than this project's usual bar, and the isolation should be
re-done on a quiet machine before any conclusion is trusted, including the
falsifications themselves.

**Definition of ready-to-file:** `repro.mjs` (in this directory, self-contained,
`npm i fastify autocannon`) reproduces ≥20% degradation between 6 and 200
routes, median of ≥3 interleaved rounds, on a machine whose spread is inside
±5–10%. Then the body above ships with `repro.mjs` attached and the
"internal status" section deleted.
