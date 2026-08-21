# HANDOFF

**Phase:** 7 opens next session — negotiator first, `negotiator` pinned as the
rule-8 oracle before any wiring. D8 is executed; the container is the courtroom.

## Done this session (all three items, in the container)

**1. `bench/Dockerfile` + `bench/container.mjs`** (commit `5b49714`):
node:22.20.0-bookworm-slim pinned, `npm ci`, repo COPIED in (never mounted),
`--cpus=8`, host BUSY-MACHINE preflight before docker, regime probe +
fingerprint on entry. **Entry probe: 582–620k opens/sec @ 5.4–5.9× — clean by
construction** (host: ~4k @ ~125×, ~140× apart on the same hardware).

**2. Exit (c) MET.** file-1kb, paired, rotating order, 5 rounds, regime OK pre
and post, no flip: **zonix 12,370 · express 7,117 · fastify 8,647 → 1.74×
Express, 1.43× Fastify**; spreads 3–7%. Six sessions frozen, adjudicated in one
run by changing courtrooms.

**3. Fastify, second environment, two windows + zonix control — and the
finding finally has a shape.** Window 1: fastify 0.998 flat; window 2: 0.665
(two 6-route processes at ~165k vs the rest at ~105k); 6-round follow-up: all
12 processes ~105k. **Fastify's per-process throughput is bimodal**: 200-route
processes 0/12 in the fast mode; 6-route processes 2/12 (the default on the
host's fast bands). zonix: 141–150k, 0.97–1.01 both windows both orders, no
modes. This single fact explains every cliff/flat/inversion reading of four
sessions.

## Decisions for Swapnil

- **W2 wording retires "cliff".** Accurate: _zonix is flat 6→400 in every
  environment and state measured; Fastify has a higher-throughput mode only
  ever observed with small route tables._ Both halves now stand on two
  environments.
- **Upstream issue**: second environment obtained; `ISSUE.md` reframed to
  bimodal with a draft title. One cheap step before filing: `node
bench/container.mjs --no-build -- sh -c "ROUNDS=20 node
upstream/fastify-cliff/repro.mjs 6 200"` to quantify the mode rate.
- **Express docs PR**: unchanged, ready.
- **README/Phase 9**: "docker run and re-derive the table" is now a real
  feature; container absolutes (8 CPUs, co-located autocannon) are never the
  claim — ratios are.

## Things worth remembering

- The container is WSL2-kernel linux with ext4 — `open()` is ~140× cheaper
  than the host's filtered NTFS. Host socket results (hello/param/chain,
  T-0/T-1) stay valid as recorded; file and cross-framework claims are
  container-only from here (D8).
- `container.mjs` spawns `docker.exe` directly on win32; `shell:true`
  re-splits quoted `-e` arguments.
- Investigation scripts under `upstream/fastify-cliff/` derive ROOT from
  their own location and run inside `/zonix` unchanged.

## Next

1. **Phase 7**: `lib/negotiation/` (Accept/-Encoding/-Language/-Charset,
   q-values, linear parsers) with `negotiator` pinned + differential + seeded
   fuzz FIRST; then ETag/fresh (landmine: `If-None-Match: *` is unconditional),
   range/206, compression, serveStatic cache — the W1/M1 stack, now
   adjudicable in the container on day one.
2. Fast-mode rate sampling (above) when convenient; then file or not.
3. Still open: item 8 (GC audit).

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework and
file claims: container only (`bench/container.mjs`), regime pre AND post,
REGIME-FLIP voids. Host: BUSY-MACHINE, intra-config spread >10% = lying.
Rule 9: table-size claims carry a zonix flat-control; sign-sensitive claims
need a second environment. Local claims Node 22-only until Phase 9 CI.
