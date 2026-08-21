# HANDOFF

**Phase:** 6 — `req` compat surface landed. Next: the `res` compat surface.

## Done this session

**1. Rule 7 regime preflight** (`bench/regime.mjs`, wired into `run.mjs`, `interleave.mjs`, `ab.mjs`).
Measures `open`+`read`+`close` on the real fixture before any file scenario and stamps `DEGRADED-REGIME`
below 50k opens/sec. Also reports reads through an open fd, because the ratio is what separates a filter
driver from a slow disk. **This machine currently reads 3,489 opens/sec — still degraded**, so file
scenarios stay unadjudicable until the AV exclusion is in place.

**A second preflight came out of a mistake.** The first run of the new scenarios went through the
sequential matrix and reported zonix/hello at 80,787 against 145,779 an hour earlier, Express down 40%,
and Fastify — benched last — untouched. Background agents were eating CPU. The harness now samples
system-wide utilization from `os.cpus()` and stamps `BUSY-MACHINE` above 20%. (A spin loop was tried and
rejected: one thread on a 24-core box takes an idle core and reports all-clear.)

**2. Fastify schema question — settled.** `bench/servers/fastify.js` declared **no** response schema, so
`fast-json-stringify` has never been active in any recorded matrix. Added `bench/servers/fastify-schema.js`.
Measured, **schema compilation is worth ~1%, not the gap** — so D5's `serialized()` wiring is an API
feature, not a performance play. Adjust W3 expectations accordingly.

**3. New scenarios — first numbers** (interleaved, quiet machine, 5 rounds):

| Scenario         |   zonix | express | fastify | fastify-schema | vs fastify |
| ---------------- | ------: | ------: | ------: | -------------: | ---------: |
| hello            | 142,963 |  26,024 | 147,904 |        148,544 |      0.97× |
| routes-200-param | 135,309 |  22,360 |  96,480 |         97,760 |  **1.40×** |
| post-json-echo   |  62,134 |  16,633 |  62,787 |         62,890 |      0.99× |

**W2 is met on `routes-200-param`: 1.40× Fastify, 6.05× Express**, distributions non-overlapping across all
five rounds. From a 6-route table to 200, zonix loses 5.4% and Fastify loses 34.8%. **Fastify's degradation
is not profiled and is not claimed as mechanism** — flamegraph that before publishing anything.

**4. Phase 6 `req` surface.** `get`/`header`, `originalUrl`, `baseUrl`, `protocol`, `secure`, `hostname`,
`subdomains`, `ip`, `ips`, `xhr`, `is()`, plus `trustProxy`/`subdomainOffset` options and a zero-dependency
proxy-addr equivalent (`lib/http/proxy.ts`: CIDR matching, loopback/linklocal/uniquelocal presets, IPv4 and
IPv6, IPv4-mapped addresses). **237 tests green** on Node 20.20.2 and 22.20.0 (+72).

## Phase 6 notes worth keeping

- **Zero per-request cost.** Settings are compiled once and hung on the `http.Server`; requests reach them
  via `req.socket.server`. Every accessor is a getter caching into one lazily-created object, so a request
  that touches none of them allocates nothing and never enters `compat/`.
- **Regression gate (rule 2): PASS.** Same-session paired A/B vs the pre-Phase-6 build, hello-world, 5 pairs,
  run three times: +0.07%, +0.42%, −1.44% — all inside the 2% budget and consistent with zero, which is what
  lazy accessors should cost. `bench/ab.mjs --mode=gate` now reports PASS/FAIL against that budget instead of
  the optimization keep/revert wording.
- **The research caught bugs the obvious implementation would have shipped**, all now covered by tests:
  `"[::1]:3000".split(":")[0]` is `"["`, not the host; `req.ips` must be truncated at the first _untrusted_
  hop (my first version returned the whole spoofable header); `is()` returns the matched string, not `true`;
  `+json` expands to `*/*+json`; `urlencoded` and `multipart` are hard-coded, not MIME lookups; `referer`
  and `referrer` alias with `||` so an empty `referer` yields `""`; `__proto__` must not escape into the
  prototype chain.

## Deferred, with reasons

- **`accepts()` family, `fresh`/`stale`, `range()`** — the Phase 6 bullet lists them, but the authoritative
  tree tags their machinery **[P7]** (`negotiation/`, `http/fresh.ts`, `http/range.ts`). Building them now
  would mean inventing a negotiator ahead of its phase. They land in Phase 7.
- **`req.host`** — Express 4 and 5 disagree (4: alias of `hostname`; 5: includes the port). Shipping either
  silently would be a compat trap. **Needs a decision**; `hostname` is unambiguous and is implemented.

## Next

1. Phase 6 `res` surface: `send`, `set`/`get`/`append`, `type`, `sendStatus`, `cookie`/`clearCookie`
   (signed), `locals`, `vary`, `format`, `links`, `location`, `download`.
2. Then the Phase 6 exit test: a handler copied from the Express docs runs unmodified.
3. Still open: item 8 (GC audit), the `req.host` decision, and file-scenario re-adjudication once the AV
   exclusion lands.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework claims come from
`bench/interleave.mjs` only — never the sequential matrix. Check both preflights before believing a number.
