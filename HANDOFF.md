# HANDOFF

**Phase:** between 6 (closed) and 7. This session was T-1 only, per instruction.
**Turbo is DEAD** — killed at T-1 under D7. Next: Phase 7.

## Done this session — T-1, the D7 adjudication

Built the thinnest **end-to-end** Turbo path per the Session 8 sharpened spec
(`bench/servers/spike/t1/`): real request-line + header parse with limits
enforced (token method, no-ws-before-colon, 100-header/8KB-line/16KB-head caps,
strict CL digits, dup-CL → 400, TE → 501), the head-of-line ordering queue in
the measured path at depth 1, the documented zonix `res` subset
(`status()`/`set()`/`json()`, per-request serialization and header build — no
static buffers), static-map dispatch, CL body draining, 8-deep pipeline cap.

**Correctness before numbers** (standing practice): `gauntlet.mjs` **16/16** —
including the HOL proof (slow first request, responses still in request order)
and fatal-behind-in-flight (parse error waits for earlier responses, in order,
then 400 + close). `smoke.mjs` verified all four servers' bodies both brackets.

**The judged cell** (p=1, C=6, sync hello, paired, 5 rounds, cpu OK 3.7%):

| vs      |  ratio | bar   | result                                          |
| ------- | -----: | ----- | ----------------------------------------------- |
| raw     | 1.362× | 1.40× | **FAILED** (pairs 1.29–1.39, none reached 1.40) |
| fastify | 1.392× | 1.30× | cleared                                         |
| zonix   | 1.408× | —     | informational                                   |

**One bar missed → Turbo dies.** No re-rolls: the config was fixed in advance,
the median of paired rounds is the number.

**The erosion is the finding:** T-0's spike read 1.71× at p=1; the end-to-end
path reads 1.36× — real parsing + HOL + per-request response building ate ~20%
of throughput. That is exactly the question T-1 existed to answer before any
smuggling/fuzz investment, and D7's raised bar did its job. Corking bracket
confirmed TURBO.md §6: sync p=16 1.65×, async p=16 1.55×, p=1 corking never
engages. Full write-up in `bench/results.md`; TURBO.md status banner records
the kill and stays as the design + falsification record.

## Things worth remembering

- **`turbo/zonix` was 1.41×** — the ceiling a transport swap could have bought a
  zonix user. Recorded so nobody re-proposes this without new physics.
- **async bracket** (setImmediate in all four servers): turbo/raw 1.28×,
  turbo/fastify 1.33× — the margin shrinks further under async handlers.
- The t1 parser/gauntlet are reusable instrumentation (16-check raw-wire
  correctness harness, HOL/framing tests) if any raw-socket work ever returns.

## Next

1. **Phase 7** — negotiation, ETag/304, ranges, compression, opt-in static
   cache (W1/M1). Landmine on record: `If-None-Match: *` is unconditional —
   skip freshness when there is no validator; ETag-off is not a mitigation.
2. **Regime preflight first** — it decides whether the AV exclusion landed
   (last reading ~3.5k opens/sec, DEGRADED-REGIME; M1 blocked on it).
3. **M3** (`bench/startup.mjs`) + upstream filings (Fastify cliff repro,
   Express `req.is` docs PR).
4. Still open: item 8 (GC audit).

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework claims
come from `bench/interleave.mjs` only. Check both preflights (DEGRADED-REGIME,
BUSY-MACHINE) before believing a number. Local claims are Node 22-only until
Phase 9 CI owns the matrix.
