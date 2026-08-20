# HANDOFF

**Phase:** 5 complete — v1 done. All five phases green.

## Done

- **Phase 0** — scaffold: package.json (ESM, zero runtime deps, engines >=20), tsconfig strict +
  `noUncheckedIndexedAccess`, prettier, git init.
- **Phase 1** — core loop: `ZonixRequest`/`ZonixResponse` via `createServer({ IncomingMessage, ServerResponse })`,
  global `use()` chain, `status/json/redirect`, central error dispatch, default 404, `listen/close/address/server`.
- **Phase 2** — radix router: segment-keyed tree per method, params, tail wildcard, static > param > wildcard with
  backtracking, trailing/repeated-slash normalization, per-segment decode (malformed -> 400), duplicate and
  bad-pattern detection, `fallback()`, exact-path `Map` fast path.
- **Phase 3** — `res.sendFile()` (stat -> MIME table -> `pipeline()`), `res.attachment()`, disconnect tagging,
  headersSent guards, double-fault path.
- **Phase 4** — batteries: `parseJSON`, `serveStatic`, `cookieParser`, `cors`.
- **Phase 5** — bench harness (`npm run bench`) and README with the recorded table.

## Definition of done — verified

- 141 tests pass on **Node 22.20.0 and Node 20.20.2** (both run, not assumed).
- `tsc --noEmit` clean, `tsup` build clean (ESM + .d.ts), prettier clean.
- `package.json` has **no** `dependencies` key.
- `examples/basic.ts` exercises every public feature; smoke-tested over curl.
- Bench (2 consistent runs, `-c 100 -p 10 -d 10`): zonix **133,862 rps** vs express 26,307 (5.1x, target was
  >= express) and fastify 149,133 (zonix at ~90%, i.e. ~11% behind; target was within ~15%).

## Deviations from CLAUDE.md (accepted)

- Handler/Middleware return type is `unknown`, not `void | Promise<void>`: the union breaks TS's void-return
  exemption, which would reject the idiomatic `(req, res) => res.status(204).end()`. Promises still detected at runtime.
- `#dispatchError` calls `handleErr` **even when headersSent** (socket destroyed first, writes swallowed) so the
  disconnect test's "handleErr sees clientDisconnect: true" holds. Decision 5 reads as destroy-and-stop.
- Default error responder honours `err.status` for 4xx (needed for malformed-encoding -> 400); 5xx still returns
  the generic `Internal Server Error` with no message or stack.
- Disconnect tagging extends decision 6: an aborted write surfaces as `ERR_STREAM_DESTROYED`, outside the code
  list, so dispatch also tags `clientDisconnect` when `req.destroyed && !res.writableFinished`. Verified against
  real aborts.
- `res.sendFile()` returns a promise but self-attaches a rejection handler: an un-awaited failure routes to
  `handleErr` via a response error sink instead of becoming an unhandled rejection, WeakSet-deduped so an awaited
  failure dispatches exactly once.
- Added `req.path`; `query`/`params`/`cookies` are null-prototype objects.
- Router extras: `/files/*` also matches `/files` (captures `""`), repeated slashes collapse, duplicate param
  names throw. HEAD does **not** fall back to GET routes (keeps method isolation as specified) — README roadmap.
- Middleware extras, safely defaulted: `serveStatic` ignores dotfiles by default (`.env` never served) and takes
  `index`; `parseJSON` rejects an oversized `Content-Length` before reading and takes `type`; `cors` sets `Vary`
  and reflects the origin instead of `*` when `credentials: true`.
- Added `scripts/run-tests.mjs` (not in the planned layout): Node 20's test runner rejects glob patterns and
  cmd.exe will not expand one, so the runner enumerates `test/*.test.ts` itself. Zero dependencies.

## Next (post-v1 candidates)

Signed cookies, HEAD falling back to GET, and the two `stat` calls per `serveStatic` hit collapsed into one.

## Blockers / open questions

None.
