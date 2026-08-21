# HANDOFF

**Phase:** 7 opens next session — negotiator first, oracle tests from day one.
This session: regime verdict, M3, upstream drafts (present-only, nothing filed).

## Done this session

**1. Regime preflight: the AV exclusion has NOT landed.** 3,897 / 4,617 / 4,506
opens/sec (threshold 50,000) — the same ~4k band as every session since BI-1,
reads-on-open-fd 123–163× faster (filter-driver signature), and system-wide:
fixture dir 3,863, repo `bench/` 4,200, `os.tmpdir()` 4,453. **DEGRADED-REGIME;
W1/M1 stays frozen — fifth session.** Whatever was excluded, `open()` is still
intercepted everywhere.

**2. M3 shipped** (`bench/startup.mjs`, clean installs in gitignored
`bench/.m3/`, zonix from its own `npm pack` tarball):

| framework | install | files | pkgs | cold import | RSS 10k (gc) |
| --------- | ------: | ----: | ---: | ----------: | -----------: |
| zonix     |  116 KB |     5 |    1 |     16.2 ms |      47.1 MB |
| express   | 2.21 MB |   618 |   68 |     77.5 ms |     100.8 MB |
| fastify   | 7.38 MB | 2,033 |   56 |     68.8 ms |      56.3 MB |

Margins: express 19.5×/124×/68 pkgs/4.8×/2.1×; fastify 65×/407×/56 pkgs/4.2×/
**1.20× RSS — the small margin published as plainly as the large ones.** Bonus
finding: first-ever import after install read express 1,240 ms / fastify
1,487 ms (zonix 21.6 ms) — the filter driver scanning fresh files; on AV-laden
machines the file-count margin becomes a first-cold-start wall-clock margin.

**3. Upstream drafts — both written, NOTHING filed (`upstream/`):**

- **Express docs PR (`express-docs/PR.md`): READY pending review.** The 4x and
  5x docs claim `req.is('application/*')` returns the pattern; verified against
  `type-is@1.6.18` AND `@2.1.0` (Express 5's line — installed and run today)
  plus the wire test: all return the matched type. Source files located
  (`src/content/api/{4x,5x}/api/request/index.mdx` on `main`); 4-line diff
  drafted; prose is already correct, only the examples are wrong.
- **Fastify cliff issue (`fastify-cliff/ISSUE.md`): NOT ready — blocked on its
  own minimal repro.** The recorded harness reproduced again today (93,424 →
  70,896, −24%, third session), but a from-scratch minimal server does NOT show
  the cliff. Paired swap test localizes the trigger to
  `bench/servers/fastify.js` (ratio contrast 0.24–0.41 per round, every round);
  falsified one-at-a-time: handler style, the fixed-route mix, shared options
  object. **Machine caveat: socket benches wobbled ~40% intra-config today
  (norm ~5%) with CPU preflight green — a preflight blind spot; today's
  falsifications are low-confidence and isolation restarts on a quiet machine.**

## Things worth remembering

- **The CPU preflight can be green while socket benches are unusable.** Today:
  40% intra-config spread, inverted concurrency response (c=20/p=4 faster than
  c=100/p=10), effects appearing/disappearing between rounds. Suspect the
  filter driver in an aggressive mode after heavy npm/file churn. If Phase 7
  W1 numbers wobble like this, stop and re-run another day — don't bisect noise.
- The Express-docs defect is now triple-verified (both type-is majors + wire).
- `bench/.m3/` is gitignored scratch; `--fresh` reinstalls.

## Next (Phase 7 — per session instruction)

1. **Negotiator first** (`lib/negotiation/`): Accept / Accept-Encoding /
   Accept-Language / Accept-Charset, q-values, specificity, linear parsers only.
   **Oracle tests day one:** pin `negotiator` as a devDependency, differential
   - seeded fuzz per rule 8 — before wiring into `req.accepts`/`res.format`.
2. Then ETag + fresh → 304 (`http/etag.ts`, `http/fresh.ts`) — landmine on
   record: `If-None-Match: *` is unconditional; skip freshness when there is no
   validator. Then range/206, compression, serveStatic cache (W1 stack).
3. W1/M1 file adjudication still frozen on the AV exclusion (regime preflight
   decides).
4. Open: Fastify repro isolation (quiet machine), Express docs PR filing
   decision (Swapnil), item 8 GC audit.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework claims
from `bench/interleave.mjs` only. Check both preflights — and now also watch
intra-config spread: >10% means the machine is lying regardless of preflights.
Local claims are Node 22-only until Phase 9 CI owns the matrix.
