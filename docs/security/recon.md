# Security Audit — Phase 0 Recon Note

**Target:** zonix-http · **Date:** 2026-08-25 · **Commit baseline:** master @ 7b9ca1a (v0.2.0 shipped)

## Baseline health

| Check | Result |
|---|---|
| Test suite (`npm test`) | **940/940 green** (2 consecutive clean full runs; one non-reproducing flake observed once — noted below) |
| Type build (`tsc --noEmit`) | green |
| Lint (`prettier --check`) | green in CI; locally reports 8 files due to `core.autocrlf=true` rewriting the working tree to CRLF while prettier expects LF — the committed bytes are LF (CI `format:check` passes on them). Not touched. |

Flake note: a single full-suite run reported `1 fail` among the http range/precondition
area; every directory passes in isolation and two subsequent full runs were clean.
Tracked as a pre-existing intermittent (likely ephemeral-port / timing), not a regression.
Not a blocker for the audit baseline.

## Toolchain

- **Test runner:** `node:test` via `tsx`, enumerated by `scripts/run-tests.mjs` (Node 20 + 22 compatible; no glob dep). `.test.ts` and `.fuzz.ts` under `test/`.
- **Build:** `tsup lib/index.ts --format esm --dts --sourcemap` (ESM only).
- **Typecheck:** `tsc --noEmit` (strict).
- **Lint/format:** `prettier` (`format:check`).
- **Runtime dependencies:** **0** (`dependencies: {}`). Oracles/tools are devDeps only (express, qs, cookie-parser, negotiator, fresh, range-parser, etag, compression, body-parser, type-is, content-disposition, cookie-signature, supertest, autocannon, fastify, find-my-way, cpeak, tsx, tsup, typescript, prettier).

## Assumed-path → actual-path (all confirmed)

| Brief assumes | Actual | Status |
|---|---|---|
| lib/middleware/serve-static.ts | same | ✔ |
| lib/body/read.ts + lib/body/* | same (json, urlencoded, raw, text, read) | ✔ |
| lib/query/extended.ts | same (+ lib/query/simple.ts) | ✔ |
| lib/response.ts | same | ✔ |
| lib/http/proxy.ts | same | ✔ |
| lib/internal/compress.ts | same | ✔ |
| lib/middleware/compression.ts | same | ✔ |
| lib/cookies/* | same (parse, serialize, sign) | ✔ |
| lib/router/index.ts | same (+ mount.ts, normalize.ts, radix.ts) | ✔ |
| server wiring (http.createServer) | lib/app.ts:94 | ✔ |
| error dispatch | lib/internal/dispatch-error.ts | ✔ |

No deviation from the brief's file assumptions.

## Feature matrix (present / absent)

| Feature | Present? | Evidence | Audit disposition |
|---|---|---|---|
| Multipart / file upload | **Absent** | no parser; only MIME-string mentions in mime.ts / compat | **ZH-011 Not applicable** |
| WebSocket / `upgrade` | **Absent** | zero `upgrade`/`websocket` hits in lib/ | **ZH-012 Not applicable** |
| HTTPS / TLS server creation | **Absent** | `lib/app.ts` uses `http.createServer` only; TLS refs are read-only `req.protocol`/`req.secure` detection | **ZH-023 Not applicable** (documented: bring your own `https.createServer`/terminating proxy) |
| Request-body decompression | **Absent** | no `gunzip`/`inflate`/`brotliDecompress` in lib/; compression is response-only | **ZH-015 request-side Not applicable**; response compression audited |

Absent features are audited as `Not applicable` with documentation, not invented.

## Server timeout posture (pre-audit observation, feeds ZH-004)

`lib/app.ts` sets **no** `server.requestTimeout` / `headersTimeout` / `keepAliveTimeout` overrides —
Node's defaults apply as-is. Flagged for ZH-004 (slowloris/timeout hardening).

## test/security/ scaffold

Created with `_baseline.test.ts` (wiring check). Per-finding regression tests land here.
