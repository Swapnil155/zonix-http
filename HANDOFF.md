# HANDOFF

**Phase:** 6 — restructure commit merged. Next: the Express `req`/`res` compat surface.

## Done this session

- **BI-1 closed.** The session-3 competitor file collapse was not a competitor problem: `open()` is rate limited
  system-wide (3,400–3,900/sec, ~260µs each; reads on an already-open fd run at 673,664/sec, and `os.tmpdir` is
  equally slow), so every framework is pinned at that ceiling. Interleaved, zonix measured 4,199 against express
  4,252 and fastify 4,389 — **zonix collapsed too**, versus the 23,026 its own sequential matrix reported minutes
  earlier. Cross-framework file claims are retired; the paired **+98.4%** survives. `bench/interleave.mjs` is now
  the only sound cross-framework instrument here. Full write-up in `bench/results.md`.
- **Phase 6 restructure commit**: compact tree → the authoritative full tree. Pure moves plus import updates,
  nothing else. 165 tests green **before and after**, on Node 22.20.0 and 20.20.2, and the built public export
  surface is byte-identical either side (verified by diffing `Object.keys` of the built module).

## Layout now

`lib/`: `index.ts` (barrel only) · `app.ts` · `request.ts` · `response.ts` · `types.ts` ·
`internal/{constants,run-chain,dispatch-error}.ts` · `router/{index,radix,normalize}.ts` ·
`errors/{index,disconnect}.ts` · `http/{mime,serialize}.ts` · `cookies/parse.ts` · `query/simple.ts` ·
`body/json.ts` · `middleware/{serve-static,cors}.ts`.

`test/` mirrors it: `core/` · `body/` · `cookies/` · `middleware/` · `fuzz/` · `helpers/{make-app,tripwire}.ts`.

## Deviations from the tree (deliberate, small — worth a decision)

- **`http/serialize.ts` has no slot in the authoritative tree** (it postdates it). Placed under `http/` as the
  inlined equivalent of `fast-json-stringify`, matching structure rule 2. **Add it to the tree in CLAUDE.md.**
- **`body/read.ts` was not split out**: the byte-limited reader is still inline in `body/json.ts`. It earns its
  own file when `urlencoded`/`raw`/`text` arrive in Phase 8 and actually share it.
- **`helpers/raw-client.ts` not created** — the tree tags it for the P7 304/206 tests, and scaffolding it empty
  would violate "do not scaffold the tree empty". Two suites still carry small local raw clients; fold them into
  the shared helper when P7 needs it.
- `cookies/parse.ts` holds both `parseCookieHeader` and the `cookieParser()` middleware factory. The tree gives
  the middleware no separate home.

## Next

1. Phase 6 compat surface: `req` (`get`/`header`, `originalUrl`, `baseUrl`, `ip`/`ips`, `protocol`, `hostname`,
   `xhr`, `is()`, `accepts()` family, `fresh`/`stale`, `range()`), `res` (`send`, `set`/`get`/`append`, `type`,
   `sendStatus`, `cookie`/`clearCookie`, `locals`, `vary`, `format`, `links`, `location`, `download`).
   Performance rule 1 applies throughout: lazy, accessor-based, zero cost when untouched.
2. Regression gate at phase close: same-session paired A/B, at least 5 pairs, no more than 2% off hello-world.
3. Item 8 (GC audit) still not started.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Before believing any file benchmark, run the `open()`
probe — if open+read+close is in the thousands per second rather than the hundreds of thousands, the rig is in
the slow regime and the numbers describe the filter driver, not the framework.
