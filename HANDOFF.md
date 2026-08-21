# HANDOFF

**Phase:** 6 — `req` and `res` compat surfaces landed. Next: the Phase 6 exit test.

## Done this session

**1. W2-V — PASSES, and the claim is now narrower.** The control (`routes-6-param`:
`routes-200-param` with _only_ the table size changed) shows the win is entirely a
table-size effect:

| Scenario         |   zonix | express | fastify | vs fastify |
| ---------------- | ------: | ------: | ------: | ---------: |
| routes-6-param   | 117,254 |  22,315 | 120,422 |  **0.97×** |
| routes-200-param | 115,994 |  20,053 |  82,720 |  **1.40×** |

6 → 200 routes costs zonix **1.1%**, Express 10.1%, Fastify **31.3%** (the earlier
34.8% was inflated by comparing against `hello`, which changed three variables).
**At 6 routes Fastify is ahead** — the publishable claim says so.

Mechanism: find-my-way's `find` is 1.2–1.4% at _both_ sizes, so it is not the router
walk. `process.nextTick` goes **0.96% → 21.94%**. Four candidates were tested and
rejected: distinct handler closures, requested-path variety, schema compilation, GC.
`bench/scaling.mjs` shows a **cliff, not a slope** — Fastify flat to 50 routes, −30%
between 50 and 100, flat again to 400; zonix flat 6→400. The root cause inside
Fastify is **not** claimed. Full write-up and scenario spec in `bench/results.md`.

**2. D6 — `req.host`** returns the host _with_ its port (Express 5); `hostname` is the
port-stripped form. `getHostname` now derives from `getHost` so trust handling cannot
drift between them.

**3. MIME table** grown to ~106 curated types with `resolveType()`, which `res.type()`
needs.

**4. `Content-Disposition` was wrong and is fixed.** The Phase 3 hand-rolled header
differed from the real package on **14 of 15** filenames: it emitted `filename*` for
plain ASCII names, _deleted_ quotes instead of escaping them, left the path in the
header, and produced a malformed `filename*=UTF-8'''name'`. `lib/http/content-disposition.ts`
implements RFC 6266/5987 properly and is pinned by a differential test against
`content-disposition@0.5.4` (30 curated names + 2000 seeded fuzz names).

**5. Phase 6 `res` surface**: `send`, `set`/`header`, `get`, `append`, `type`,
`vary`, `links`, `location`, `sendStatus`, `locals`, `cookie`, `clearCookie`, plus
`cookies/serialize.ts` and `cookies/sign.ts`. **358 tests green** on Node 20.20.2 and
22.20.0; regression gate **PASS** (+0.31%).

## Things worth remembering

- **Cookie signing is wire-compatible** with `cookie-signature`, verified both
  directions. Standard base64, padding stripped (`base64url` would break interop);
  comparison is `timingSafeEqual`, not the reference `==`.
- **`clearCookie` applies the expiry after the caller's options**, so passing `maxAge`
  cannot turn a clear into a renewal — an Express 4 footgun.
- **Cookie/header validators are linear char scans, not regexes.** Character-class
  regexes over these ranges (`]`, `\`, quotes, NUL) were written wrong twice by
  escaping accidents before this was switched; decision 11 wants linear parsing anyway.
- **`res.send(number)` throws** per decision 13, pointing at `sendStatus`.
- **A benchmark's own tooling can lie**: the CRLF test initially "failed" because the
  injected header name appears inside the correctly _encoded_ value. Assert on the
  header line, not the substring.

## The adversarial review landed after the code, and found four things

The res research finished after the surface was already written, so it was applied
as a review pass. Three findings changed the code; one is a Phase 7 landmine.

1. **A real vulnerability in `content-disposition@0.5.4`.** Its ISO-8859-1 fallback
   guard uses a `/g` regex with `.test()`, so `lastIndex` persists across calls and
   **every third call silently accepts** — the package emits
   `filename="a
X-Injected: yes"`, genuine header injection through
   `options.fallback`. Reproduced live. **Our port is immune** (it resets `lastIndex`
   on both paths) and now has a regression test so a refactor cannot reintroduce it.
2. **`Object.prototype.encode` could hijack cookie encoding.** Express reads
   `opt.encode` with a plain lookup that walks the prototype chain; a polluted
   prototype would replace the escaping that stops attribute injection. Ours now
   reads it as an own property, with a test that pollutes the prototype and asserts
   `;` is still escaped.
3. **`withCharset` was wider than Express.** It added `; charset=utf-8` to
   `application/vnd.api+json`; Express's rule is `text/*` plus
   `application/javascript|json` only. Narrowed to match — being arguably more
   correct than Express is not worth a silent `Content-Type` divergence.
4. **Phase 7 landmine, recorded now:** `If-None-Match: *` is **unconditional** — it
   makes `req.fresh` true even when the response carries no ETag and no
   `Last-Modified`. **Turning ETag off is not a mitigation.** When freshness lands,
   either skip the check when there is no validator, or treat `*` as matching only
   when one is present. Also for Phase 7: ETag hashes every response with a body
   (not just 2xx), `fresh@0.5` and `fresh@2` disagree on If-None-Match precedence,
   and `Content-Disposition` is emitted on 304/206/412/416 too.

## Deferred, with reasons

- **`res.format`** needs the Phase 7 negotiator; **ETag/freshness inside `send`** needs
  `http/etag.ts` + `http/fresh.ts`; **`req.accepts`/`fresh`/`stale`/`range`** likewise.
  All tree-tagged [P7]. `res.download` follows once `sendFile` and disposition meet.
- **`contentDisposition` basename deviates deliberately**: `\` and a drive-letter
  prefix are separators on every platform, where `path.basename` is platform-dependent
  and would leave `..\..\secret.pdf` intact on POSIX. For the compat table.
- **`res.type` throws on an unknown extension** where Express writes the literal
  string `"false"` into the header. For the compat table.

## Next

1. Phase 6 exit test: a handler copied from the Express docs runs unmodified.
2. Then Phase 7 (negotiation, caching, compression) — which unblocks the deferrals
   above and is also the W1 static stack.
3. Still open: item 8 (GC audit), and file-scenario re-adjudication once the AV
   exclusion lands (this rig still reads ~3.5k opens/sec, DEGRADED-REGIME).

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework claims come
from `bench/interleave.mjs` only. Check both preflights (DEGRADED-REGIME,
BUSY-MACHINE) before believing a number.
