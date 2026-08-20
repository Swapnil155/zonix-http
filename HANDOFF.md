# HANDOFF

**Phase:** 5 — Bench + polish (starting)

## Done

- Phase 0: scaffold — package.json (ESM, zero deps, engines >=20), tsconfig strict + `noUncheckedIndexedAccess`, prettier, git init.
  Test runner choice: `node --import tsx --test "test/**/*.test.ts"` (clean on Node 22.20).
- Phase 1: core loop — `ZonixRequest`/`ZonixResponse` subclasses via `createServer({ IncomingMessage, ServerResponse })`,
  flat-Map router (exact paths only), global `use()` chain, `status/json/redirect`, central error dispatch, default 404,
  `listen/close/address/server`, method sugar.
- Phase 2: radix router — segment-keyed tree per method, params, tail wildcard, static > param > wildcard with
  backtracking, trailing-slash + repeated-slash normalization, per-segment decode (malformed -> 400), duplicate and
  bad-pattern detection, `fallback()`. Exact-path `Map` fast path for fully static routes.
- Phase 3: `res.sendFile()` (stat -> MIME table -> `pipeline()`), `res.attachment()` with header-injection guards,
  `lib/internal/mimeTypes.ts` (~33 types), disconnect tagging, headersSent guards on every send path.
- Phase 4: batteries — `parseJSON`, `serveStatic`, `cookieParser`, `cors`, all exported from `lib/index.ts`.
- 141 tests green across 9 files. Prettier clean, `tsc --noEmit` clean.

## Deviations from CLAUDE.md (accepted, note if wrong)

- Handler/Middleware return type is `unknown`, not `void | Promise<void>`: the union breaks TS's void-return
  exemption, which would reject the idiomatic `(req, res) => res.status(204).end()`. Promises are still detected at runtime.
- `#dispatchError` calls `handleErr` **even when headersSent** (socket destroyed first, writes swallowed) so the
  disconnect test's "handleErr sees clientDisconnect: true" holds. CLAUDE.md decision 5 reads as destroy-and-stop.
- Default error responder honours `err.status` for 4xx (needed for malformed-encoding → 400); 5xx still returns the
  generic `Internal Server Error` with no message or stack.
- Added `req.path` (pathname, undecoded) — needed internally by routing/serveStatic, matches Express.
- Router extras beyond the spec: `/files/*` also matches `/files` (captures `""`), repeated slashes collapse, and
  duplicate param names in one pattern throw. HEAD does **not** fall back to GET routes (keeps method isolation
  as specified) — listed as roadmap instead.
- Disconnect tagging extends decision 6: an aborted write surfaces as `ERR_STREAM_DESTROYED`, which is not in the
  code list, so dispatch also tags `clientDisconnect` when `req.destroyed && !res.writableFinished`. Verified
  against real aborts (mid-sendFile gives `ERR_STREAM_PREMATURE_CLOSE`, mid-write gives `ERR_STREAM_DESTROYED`).
- `res.sendFile()` returns a promise and self-attaches a rejection handler: an un-awaited failure is routed to
  `handleErr` through a response error sink instead of becoming an unhandled rejection. A WeakSet dedupes so an
  awaited failure dispatches exactly once.
- Middleware extras beyond the spec, all defaulted safely: `serveStatic` ignores dotfiles by default
  (`dotfiles: "allow"` opts in) so `.env` is never served, and takes an `index` option; `parseJSON` rejects an
  oversized `Content-Length` before reading a byte and accepts a `type` option; `cors` sets `Vary` correctly and
  reflects the origin instead of `*` when `credentials: true`.
- `req.query`, `req.params` and `req.cookies` are null-prototype objects, so a `__proto__` key is inert data.

## Next

Phase 4 batteries, in order: `parseJSON` (content-type gate, byte-counted limit -> 413, malformed -> 400,
empty -> `{}`), `serveStatic(root)` (resolve + `startsWith(root + sep)` -> 403, dir -> index.html, miss -> `next()`),
`cookieParser` (unsigned), `cors`. One test file each.

## Blockers / open questions

None.
