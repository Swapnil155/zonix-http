# HANDOFF

**Phase:** 8 — IN PROGRESS (S24, 2026-08-22). s1: Router/mounting/error
middleware/maxParamLength (`ed40a62`). s2: qs-oracle extended query +
urlencoded/raw/text (this commit). **OPEN: the s2 hello gate was not
adjudicable — host noisy (Spotify, Docker backend, Task Manager); three runs
+0.60% / −1.06% / +4.20% with pair spreads >10%. FIRST THING NEXT SESSION:
quiet host; `bench/.baseline-build` is already frozen at the `ed40a62` dist
(this session's snapshot) and `dist/` is the s2 candidate — run `node
bench/ab.mjs --scenario=hello --runs=7` directly; record; only then the
express-port exit test.**

## Done this session (Phase 8 s2)

`qs@6.15.3` + `body-parser@1.20.6` pinned exact. `lib/query/extended.ts`
(linear qs semantics, null-proto, proto/`prototype` dropped, depth 5, sparse
guard with qs's overflow side-channel, parameterLimit): 117-corpus
differential + 15-vector pollution suite + 10k×3-seed fuzz green BEFORE
wiring. `queryParser: "extended"` (Express's `arrayLimit: 1000`, depth 5).
`lib/body/read.ts` shared listener reader; `parseJSON` refactored onto it
(its suites unchanged); `urlencoded` (simple = `node:querystring`; extended =
ours with body-parser's depth 32/`max(100, params)`/1000 → 400/413), `raw`,
`text` (charset-aware, 415 for non-native charsets). 24 parser tests incl.
equivalence ×4 and byte-exact limits ×4; 73-probe wire-diff vs Express +
body-parser identical, deviations asserted. **848/848; echo paired +2.58%.**
Section "Phase 8, session 2" in `bench/results.md`.

## Next

1. Hello gate re-run on a quiet host (see above). 2. Express-port exit test
   closes P8. 3. Phase 9 (npm). Swapnil-side: scorecard ranges in CLAUDE.md;
   Express docs PR; Fastify discussion decision — nothing filed here.

## Standing measurement rules

Noise floor ~5% e2e; never compare rps across sessions. Cross-framework and file
claims: container only, regime pre AND post, REGIME-FLIP voids. Host:
BUSY-MACHINE, intra-config spread >10% = lying. Rule 9: table-size claims carry a
zonix flat-control; sign-sensitive claims need a second environment.
