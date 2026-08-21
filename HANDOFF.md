# HANDOFF

**Phase:** 6 — **CLOSED.** Exit test green. Next: Phase 7 (negotiation, caching,
compression — also the W1/M1 static stack).

## Done this session

**1. T-0 adjudicated on the reference rig** (spike unmodified, quiet machine,
cpu preflight OK 5.0–5.9%). `bench/results.md` has the full write-up.

| Config    | raw `node:http` |     turbo |      ratio | container |
| --------- | --------------: | --------: | ---------: | --------: |
| p=16, C=6 |         150,848 | 1,606,115 | **10.78×** |    12.63× |
| p=1, C=6  |          84,167 |   144,325 |  **1.71×** |     1.78× |

The p=1 prediction transferred to within 4%; the corked figure fell as the
colocation caveat said it would. **Both clear the 1.30× bar.**

Two checks before calling it official, and one finding that changes the story:

- The 5-test **correctness gauntlet was never delivered** with the spike code.
  Re-created as `bench/servers/spike/gauntlet.mjs`; 5/5 here.
- **Both servers are the ceiling, not the client** — driving one server with
  1/2/3 client processes leaves raw flat at ~91k and turbo saturating at ~152k.
- **At C=1 the ratio is 1.16×, below the kill bar.** One connection with no
  pipelining measures round-trip latency, which both servers pay identically.
  **Turbo is a throughput win, not a latency win.**

**2. Phase 6 exit test — and it found five real defects.** Built in two halves
sharing one corpus (`test/compat/docs-routes.ts`): `express-docs.test.ts` asserts
readable expectations, `express-differential.test.ts` runs the **same handlers on
real Express** and compares the wire. Rule 8 justified itself immediately — the
first draft asserted `res.set("Content-Type","text/plain")` gives a bare
`text/plain`, and without the oracle the "fix" would have broken correct code.

Fixed: `res.redirect(301, url)` overload missing · string bodies must force
`charset=utf-8` onto any Content-Type (Express's `setCharset`) · `req.is()` with
a wildcard returns the **matched type**, not the pattern · `res.type()` on an
unknown extension must fall back, not throw · `normalizeContentType` accepted
`a/b/c` and `-/99y`, which then matched `*/*`.

**3. `type-is@1.6.18` pinned** with its own differential + 4k-input seeded fuzz,
per rule 8 — the module inlines it and had just been proven wrong.

**4. `TURBO.md`** — the M4 design doc. Design only, nothing implemented.

**428 tests green on Node 22.20.0.** Gate **PASS** (+0.35% median paired, budget
−2%). Typecheck, build and prettier clean; zero runtime deps.

## Things worth remembering

- **The Express docs are not the oracle; the package is.** They claim
  `req.is('application/*')` returns `'application/*'`. It returns
  `'application/json'`. Two of this session's five defects came from trusting
  prose over behaviour.
- **`res.send`/`res.json` with a string body force `charset=utf-8` onto whatever
  Content-Type is set** — including `image/png; charset=utf-8`. Buffers are left
  alone. Both fixes land on cold branches only; the hot paths use a constant that
  already carries the charset, so the gate stayed green.
- **Content-type validation is RFC 6838 (media-typer), not RFC 7230 tokens**:
  must start alphanumeric, `.`/`+` are subtype-only, 127-char cap. The looser
  rule let malformed headers match wildcards.
- **A `*/` inside a JSDoc comment closes the comment.** Cost a confusing round of
  parse errors while documenting `req.is("*/*")`.
- **Node 20 is no longer installed on this machine** — previous sessions claimed
  20.20.2 + 22.20.0; this one can only claim 22.20.0.

## Deferred, with reasons

- **`res.format`, and with it the redirect courtesy body and its `Vary: Accept`**
  — both need the Phase 7 negotiator. Asserted as explicit differences in the
  differential rather than hidden by a skip.
- **`req.accepts`/`fresh`/`stale`/`range`, ETag/freshness in `send`,
  `res.download`** — all [P7], unchanged from last session.
- **Phase 7 landmine, still standing:** `If-None-Match: *` is unconditional;
  **turning ETag off is not a mitigation.** Skip the check when there is no
  validator.

## Next

1. **Phase 7** — negotiation, ETag/304, ranges, compression, and the opt-in
   static cache (W1/M1). Unblocks every deferral above.
2. **File scenarios remain frozen** until the AV exclusion lands (rig still
   ~3.5k opens/sec, DEGRADED-REGIME). M1 is blocked on it, fourth session now.
3. **Before W2/M2 ships anywhere public:** file the minimal Fastify scaling-cliff
   repro upstream.
4. Still open: item 8 (GC audit), M3 (`bench/startup.mjs` footprint + cold start).
5. **Turbo:** decide the four open questions at the end of `TURBO.md` — in
   particular whether the 1.2× bar survives the honest 1.65× headroom.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework claims
come from `bench/interleave.mjs` only. Check both preflights (DEGRADED-REGIME,
BUSY-MACHINE) before believing a number.
