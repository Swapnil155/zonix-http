# HANDOFF

**Phase:** 2 — Real router (starting)

## Done
- Phase 0: scaffold — package.json (ESM, zero deps, engines >=20), tsconfig strict + `noUncheckedIndexedAccess`, prettier, git init.
  Test runner choice: `node --import tsx --test "test/**/*.test.ts"` (clean on Node 22.20).
- Phase 1: core loop — `ZonixRequest`/`ZonixResponse` subclasses via `createServer({ IncomingMessage, ServerResponse })`,
  flat-Map router (exact paths only), global `use()` chain, `status/json/redirect`, central error dispatch, default 404,
  `listen/close/address/server`, method sugar.
- 29 tests green (`middleware`, `errors`, `response`). `examples/basic.ts` runs and was smoke-tested over curl.

## Deviations from CLAUDE.md (accepted, note if wrong)
- Handler/Middleware return type is `unknown`, not `void | Promise<void>`: the union breaks TS's void-return
  exemption, which would reject the idiomatic `(req, res) => res.status(204).end()`. Promises are still detected at runtime.
- `#dispatchError` calls `handleErr` **even when headersSent** (socket destroyed first, writes swallowed) so the
  disconnect test's "handleErr sees clientDisconnect: true" holds. CLAUDE.md decision 5 reads as destroy-and-stop.
- Default error responder honours `err.status` for 4xx (needed for malformed-encoding → 400); 5xx still returns the
  generic `Internal Server Error` with no message or stack.
- Added `req.path` (pathname, undecoded) — needed internally by routing/serveStatic, matches Express.

## Next
Replace the flat Map in `lib/router.ts` with the radix tree (decisions 2 + 3): params, tail wildcard,
static > param > wildcard with backtracking, trailing-slash normalization, per-segment decode → 400,
duplicate detection, then `fallback()` coverage. Write `test/router.test.ts` first.

## Blockers / open questions
None.
