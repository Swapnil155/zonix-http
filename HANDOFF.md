# HANDOFF

**Phase:** 7 opens next session (negotiator first, oracle tests day one) — the
regime question now has one answer per context, as required.

## Done this session

**1. Diagnosis (item 1, executed first).** Fingerprint from inside the harness
context: **native win32** 10.0.26200, `C:\Program Files\nodejs\node.exe`, cwd
on `C:\` — NOT WSL. In-context differential: repo 3.8–4.3k @ 74–166×, `%TEMP%`
4.7k @ 67–72× — **no differential, both degraded, sandbox on or off**. From
this context there is no exclusion in effect. Defender RTP on, **Tamper
Protection ON**, exclusions unreadable without admin; machine rebooted today
13:36. Remaining fork: Swapnil re-runs `probe.cjs` interactively — still 48k →
process-scoped filtering (needs admin `fltmc`/exclusion inspection); now 4k →
reverted (Tamper Protection / reboot), and "two machines" were two times.

**2. Detector port (item 2, committed `583d72c`).**
`bench/regime-constants.cjs` = the ONE copy (degraded = opens < 20,000/sec OR
ratio > 40×). `regime.mjs` + `probe.cjs` share it; every reading carries the
context fingerprint; `run`/`interleave`/`ab` check pre AND post, REGIME-FLIP
voids. Exercised live (ab.mjs pre+post; probe verdict: STILL DEGRADED here).

**3. Fastify isolation (item 3 — gate passed at 9.9% spread, then everything
changed).** Strip-isolation from the reproducing side found the minimal repro
is **bare `Fastify({logger:false})` + N async param routes** — variants
A/B/C/D/E all cliffed, 16/16 round-pairs, including callback style. Every
"trigger ingredient" from last session was wrong; the morning's flat readings
were the pre-reboot sick machine. `repro.mjs` finalized as self-contained.
**Then the twist: in a later window of the same afternoon the effect INVERTED
(+14–27%), proven non-positional by order reversal — while a zonix control
stayed flat (0.970 / 1.010) in both orders through every state.** The Fastify
table-size effect is **machine-state-dependent, sign included**, on this rig;
cliff windows correlate with fast-machine bands (6r ≥ 64k — all three recorded
sessions were there), inverted windows with slow bands (53–65k).

## What this means (decisions for Swapnil)

- **zonix's half of W2 is strengthened**: flat through machine states that
  swing Fastify ±25%, on top of flat 6→400 in every recorded session.
- **Fastify's half needs requalification**: "~30% cliff" is real but
  state-dependent on this rig. The upstream issue is NOT filable on
  single-machine evidence with a sign flip — it needs a second machine (CI
  runner, laptop, the T-0 container) or a characterized stable window, and
  the state-dependence stated in the text. `ISSUE.md` updated accordingly.
- **W2's publication wording** inherits the caveat — your call whether it
  narrows ("flat vs state-dependent") or waits for the second machine.
- Express docs PR: still ready, unaffected (`upstream/express-docs/PR.md`).

## Things worth remembering

- **The reboot at 13:36 split the day**: before it, flat/inverted readings and
  40% wobble; after it, five variants cliffing 16/16 — then a later window
  inverted again. Windows last tens of minutes. In-round interleaving does NOT
  defend against this; only cross-machine or cross-window reproduction does.
- The zonix-control pattern (measure our flat framework alongside any
  Fastify table-size claim) is cheap and decisive — keep using it.
- Investigation artifacts: `upstream/fastify-cliff/{strip.mjs, variants/,
spread-check.mjs, zonix-control.mjs, bisect.mjs}` — the record of what was
  ruled out and how.

## Next

1. **Phase 7**: negotiator (`lib/negotiation/`) first — pin `negotiator` as
   devDep, differential + seeded fuzz per rule 8 BEFORE wiring into
   `req.accepts`/`res.format`. Then ETag/fresh (landmine: `If-None-Match: *`
   is unconditional), range/206, compression, static cache (W1 stack).
2. Swapnil: interactive `probe.cjs` re-run (decides reverted vs
   process-scoped); admin exclusion re-check either way; Express docs PR
   filing; Fastify second-machine decision.
3. W1/M1 frozen until a context reads clean. Item 8 (GC audit) still open.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework claims
from `bench/interleave.mjs` only. Preflights: DEGRADED-REGIME (pre AND post,
REGIME-FLIP voids), BUSY-MACHINE, intra-config spread >10% = machine is lying.
**New: table-size comparisons additionally need a zonix flat-control in the
same run, and any sign-sensitive claim needs a second machine.** Local claims
are Node 22-only until Phase 9 CI owns the matrix.
