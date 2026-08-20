# HANDOFF

**Phase:** 3 — Response + resilience (starting)

## Done
- Phase 0: scaffold — package.json (ESM, zero deps, engines >=20), tsconfig strict + `noUncheckedIndexedAccess`, prettier, git init.
  Test runner choice: `node --import tsx --test "test/**/*.test.ts"` (clean on Node 22.20).
- Phase 1: core loop — `ZonixRequest`/`ZonixResponse` subclasses via `createServer({ IncomingMessage, ServerResponse })`,
  flat-Map router (exact paths only), global `use()` chain, `status/json/redirect`, central error dispatch, default 404,
  `listen/close/address/server`, method sugar.
- Phase 2: radix router — segment-keyed tree per method, params, tail wildcard, static > param > wildcard with
  backtracking, trailing-slash + repeated-slash normalization, per-segment decode (malformed -> 400), duplicate and
  bad-pattern detection, `fallback()`. Exact-path `Map` fast path for fully static routes.
- 62 tests green (`router`, `middleware`, `errors`, `response`). `examples/basic.ts` runs; params verified over curl.

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

## Next
Phase 3: `res.sendFile()` (stat → MIME from `lib/internal/mimeTypes.ts` → `pipeline()`), `res.attachment()`,
client-disconnect handling per decision 6, and `test/disconnect.test.ts` with an `unhandledRejection` trap.

## Blockers / open questions
None.
