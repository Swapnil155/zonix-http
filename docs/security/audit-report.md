# zonix-http — Security Audit Report

**Auditor:** Claude Code · **Date:** 2026-08-25 · **Target:** `zonix-http` @ v0.2.0 → audited branch
**Scope:** full source-level audit + hardening per `SECURITY_AUDIT.md` (ZH-001…ZH-029)
**Method:** per-finding workflow (locate → identify → attack → classify → fix → regression test → docs), one commit per finding, green suite maintained throughout.

---

## 1. Executive Summary

**Overall rating: Low residual risk — APPROVED WITH CONDITIONS** (conditions are documentation/deployment guidance, not code defects).

zonix-http was already built with a security-conscious posture (null-prototype parsers, linear-time scanners, HMAC cookies, central error dispatch that never leaks internals). The audit found **one genuinely exploitable vulnerability** (static symlink escape) and **one real injection gap** (null byte in route params), both now fixed with regression tests, plus targeted hardening of timeouts and the header choke-point and a new opt-in security-headers middleware. Everything else was verified safe and locked down with regression tests.

**Counts by severity (as found):**

| Severity              | Confirmed vulns            | Hardening / verified-safe                                                    |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| Critical              | 1 (ZH-001 symlink escape)  | —                                                                            |
| High                  | 1 (ZH-020 null-byte param) | ZH-004 timeouts, ZH-007 header choke-point                                   |
| Medium                | 0                          | ZH-022 security headers (new), ZH-014 redirect docs                          |
| Low/Info              | 0                          | ZH-002/003/005/006/008/009/010/013/015/016/017/018/019 verified              |
| N/A (absent features) | —                          | ZH-011 multipart, ZH-012 WebSocket, ZH-023 TLS, ZH-015 request-decompression |

**Confirmed remotely-exploitable Critical/High still open: 0.**

**Test posture:** full suite **1017 pass / 1 skip / 0 fail** (was 940); dedicated `test/security/` suite: **16 files, 78 tests**. `tsc` strict clean; `npm audit --omit=dev` 0 vulns; zero runtime dependencies; publish tarball is 6 files (no tests/fixtures/secrets).

---

## 2. Vulnerability Table

| ID     | Severity           | Component   | Vulnerability                                                                  | Exploitable?                                      | Fix                                                                             |
| ------ | ------------------ | ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| ZH-001 | Critical           | Static      | Symlink inside root escapes it (lexical check only, `stat` follows links)      | **Yes**                                           | realpath-validate every served file against the real root (`7d07666`)           |
| ZH-020 | High               | Router      | `%00` in a route param decoded to literal NUL, reached handlers                | **Yes** (injection into downstream FS/string ops) | reject NUL in decoded segments → 400 (`bc560a2`)                                |
| ZH-004 | High               | Server      | No pinned slow-client timeouts (version-dependent)                             | Partly (slowloris on old Node)                    | pin configurable headers/request/keepAlive timeouts (`00a9dde`)                 |
| ZH-007 | High (hardening)   | Response    | Header choke-point missed names + non-CRLF controls (Node backstops splitting) | No (Node blocks)                                  | validate names + all control chars at `assertHeaderValue` (`a110705`)           |
| ZH-022 | Medium (hardening) | Middleware  | No security-headers helper                                                     | N/A                                               | new opt-in `securityHeaders()` (`20bac9c`)                                      |
| ZH-002 | Critical→**Safe**  | Body        | Request smuggling / framing ambiguity                                          | **No**                                            | verified: Node canonical parser + reader counts delivered bytes (`f070794`)     |
| ZH-003 | Critical→**Safe**  | Parsers     | Prototype pollution                                                            | **No**                                            | verified null-proto/key-filtered everywhere (`389377a`)                         |
| ZH-005 | High→**Safe**      | Body        | Body exhaustion / CL spoofing                                                  | **No**                                            | verified received-byte cap, delivered 413 (`389377a`)                           |
| ZH-006 | High→**Safe**      | Query       | Query parser pollution/DoS                                                     | **No**                                            | verified depth/array/param caps + key filter (`389377a`)                        |
| ZH-008 | High→**Safe**      | Host        | Host-header poisoning                                                          | **No**                                            | verified XFH gated on trust; redirect not host-derived (`389377a`)              |
| ZH-009 | High→**Safe**      | Router      | Path/param decoding                                                            | **No**                                            | verified single-pass decode, malformed→400, %2F in-segment (`bc560a2`)          |
| ZH-010 | High→**Safe**      | Parsers     | ReDoS                                                                          | **No**                                            | verified: zero catastrophic regex, linear scanners (`389377a`)                  |
| ZH-013 | Med→**Safe**       | Proxy       | Trust boundary jump                                                            | **No**                                            | verified default-off, walk stops at first untrusted hop (`389377a`)             |
| ZH-014 | Med→**Design**     | Response    | Open redirect                                                                  | App-level                                         | CRLF encoded; destination validation documented as app duty (`389377a`)         |
| ZH-015 | Med→**Safe/N/A**   | Compression | Bomb / negotiation                                                             | **No**                                            | response-only (no request decompression); threshold+Vary+206 exclusion verified |
| ZH-016 | Med→**Safe**       | Cookies     | Cookie security                                                                | **No**                                            | verified HMAC timing-safe, mandatory secret, grammar validation (`389377a`)     |
| ZH-017 | Med→**Safe**       | Errors      | Info disclosure                                                                | **No**                                            | verified 5xx leaks nothing, status-gated (`later commit`)                       |
| ZH-018 | Med→**Safe**       | Methods     | TRACE / method override                                                        | **No**                                            | verified TRACE not routable/echoed, no override                                 |
| ZH-019 | High→**Safe**      | All         | Resource exhaustion                                                            | **No**                                            | verified every dimension bounded                                                |
| ZH-011 | —                  | Multipart   | —                                                                              | —                                                 | **Not applicable** — no multipart parser                                        |
| ZH-012 | —                  | WebSocket   | —                                                                              | —                                                 | **Not applicable** — no upgrade handling                                        |
| ZH-023 | —                  | TLS         | —                                                                              | —                                                 | **Not applicable** — `http.createServer` only; BYO `https`/proxy                |

---

## 3. Detailed Findings

### ZH-001 · Critical · CWE-22/CWE-59 · `lib/middleware/serve-static.ts` · CONFIRMED · High confidence

**Description:** Root containment used only a lexical `path.resolve` + `startsWith(prefix)` check, then `stat()`/`sendFile()` — both of which follow symlinks. A symlink inside the served root pointing outside it (`ln -s /etc secret`) resolves lexically inside the root and is then served from outside it.
**Attack scenario / PoC:** With a static root containing `secret -> /etc`, `GET /secret/passwd` returns `/etc/passwd`. A directory junction achieves the same on Windows.
**Impact:** Arbitrary file read outside the web root.
**Root cause:** No canonicalization of the real (link-followed) path before serving.
**Fix:** Resolve the real root once; for every served file (direct path, memory-cache path, and index files) `fs.realpath` the target and require it to equal the real root or sit under `realRoot + sep`. Serve the canonical path. Escaped paths → 403; paths that vanish in the TOCTOU window → treated as missing (404), never served.
**Regression test:** `test/security/static-symlink.test.ts` — file-symlink (POSIX), directory-junction (Windows), cache path, symlinked index; fails pre-fix, passes post-fix.
**Backward compatibility:** None — legitimate files inside the root are unaffected; only escaping links change (now 403). One extra `realpath` syscall per served file (documented).

### ZH-020 · High · CWE-158/CWE-626 · `lib/router/normalize.ts` · CONFIRMED · High confidence

**Description:** `decodeSegment` decoded `%00` to a literal NUL and returned it as a route-param value; handlers using the value in a filesystem or string operation could be truncated.
**PoC:** `GET /echo/file%00.txt` → `req.params.value === "file\0.txt"`.
**Fix:** Reject any decoded segment containing NUL with a 400, matching the existing `serveStatic` guard.
**Regression test:** `test/security/router-security.test.ts` (ZH-020 cases) — fail pre-fix, pass post-fix.
**Backward compatibility:** A `%00` in a path is never legitimate; 400 is correct.

### ZH-004 · High · CWE-400 · `lib/app.ts`, `lib/types.ts` · Hardening · High confidence

**Description:** The server set no `headersTimeout`/`requestTimeout`/`keepAliveTimeout`, inheriting whatever the Node version defaulted to (older Node had no `requestTimeout` and a shorter `headersTimeout`), leaving slow-client behavior version-dependent.
**Fix:** Pin version-stable safe defaults (60s / 300s / 5s), each overridable via `ZonixOptions` (0 disables), validated non-negative.
**Regression test:** `test/security/request-timeout.test.ts` — defaults pinned, overridable, negative rejected, idle keep-alive socket reclaimed.
**Backward compatibility:** Behavior is now stable across Node versions; identical to Node 18+ defaults, so no functional change on current Node.

### ZH-007 · High (hardening) · CWE-93/CWE-113 · `lib/compat/response.ts` · Hardening · High confidence

**Description:** The framework choke-point (`assertHeaderValue`) rejected only CR/LF/NUL in values and never validated header names; other control chars and bad names relied solely on Node's `setHeader` backstop (which does block response-splitting, so this is defense-in-depth, not an exploitable hole).
**Fix:** Reject every C0 control char except HTAB plus DEL in values (Node's own rule, one layer up), and validate the field-name as an RFC 7230 token.
**Regression test:** `test/security/header-injection.test.ts` — every API × vector; name + non-CRLF-control cases fail pre-fix, pass post-fix.
**Backward compatibility:** The accepted token/value set equals Node's, so nothing Node accepted is newly rejected.

### ZH-022 · Hardening · `lib/middleware/security-headers.ts` (new) · High confidence

**Description:** No built-in security-headers helper.
**Fix:** New zero-dependency opt-in `securityHeaders()`. Safe-by-default headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`) on every response; breakable headers (CSP, HSTS, Permissions-Policy) off until given a value; HSTS never sent on plaintext; never overrides a header a handler already set.
**Regression test:** `test/security/security-headers.test.ts`.
**Backward compatibility:** Opt-in; no default behavior change.

### ZH-002 · Critical (verified safe) · CWE-444 · `lib/body/read.ts`, `lib/app.ts`

`insecureHTTPParser` is never enabled; the body reader counts the bytes Node delivers and never re-derives length from `Content-Length`, so it introduces no second framing interpretation. Node rejects CL+TE and conflicting CLs. **No desync.** Regression: `test/security/request-smuggling.test.ts`.

### ZH-003 / ZH-006 · Critical/High (verified safe) · CWE-1321 · parsers

Every parsed container is null-prototype and/or explicitly key-filtered: extended query (`forbidden()` blocks `Object.prototype` own-props + `prototype` at every depth, null-proto output), simple query (null-proto), JSON body (`JSON.parse`, no merge), urlencoded (both modes null-proto), cookies (null-proto, `j:` via `JSON.parse`), route params (plain object but `:__proto__`/`:constructor`/`:prototype` rejected at registration). Depth 5 / arrayLimit / parameterLimit 1000 caps enforced. Regression: `test/security/query-prototype-pollution.test.ts`, `resource-exhaustion.test.ts`.

### ZH-005 / ZH-019 · High (verified safe) · CWE-400 · body + all dimensions

True received-byte cap enforced independent of declared `Content-Length` (both directions); over-limit → delivered 413, never unbounded buffering or a bare reset. Bounded dimensions: body bytes, query depth/param-count/array-size, route-param length (414), header size (Node 431). Regression: `test/security/body-limit.test.ts`, `resource-exhaustion.test.ts`.

### ZH-008 / ZH-013 · High/Medium (verified safe) · host + proxy

`trustProxy` defaults off; with it off no `X-Forwarded-*` influences `req.ip`/`req.protocol`/`req.hostname`. The XFF walk stops at the first untrusted hop, so injected leftmost entries cannot jump the boundary. `res.redirect`/`res.location` never derive from the Host header. Regression: `test/security/proxy-trust.test.ts`, `host-header.test.ts`.

### ZH-009 / ZH-021 · High/Medium (verified safe) · routing / unicode

Single-pass `decodeURIComponent` per segment; malformed encoding → 400; `%2F` stays inside a segment (not a separator); NUL rejected (ZH-020); params keyed by developer-written names with the three dangerous names rejected at registration. Regression: `test/security/router-security.test.ts`.

### ZH-010 · High (verified safe) · CWE-1333 · parsers

No catastrophic-backtracking regex on any attacker-controlled path; all negotiation/range/fresh/cookie/query parsing is linear character scans; no `new RegExp` in `lib/`. The few regex literals are on app-controlled input and bounded. Regression: `test/security/regex-dos.test.ts` (bounded-time on adversarial inputs).

### ZH-014 · Medium (design risk) · CWE-601 · `lib/response.ts`

`res.redirect` is Express-compatible and redirects where the app says; CRLF in the target is percent-encoded (no splitting). Validating a _user-supplied_ destination (open-redirect avoidance) is the application's responsibility — documented. No default change (protocol-relative/`javascript:` targets pass through as in Express). Regression: `test/security/redirect-security.test.ts`.

### ZH-015 · Medium (verified safe / partially N/A) · compression

Response compression only: min threshold 1024, `Vary: Accept-Encoding` set, 206/HEAD/`no-transform`/incompressible excluded, ETag computed on the identity body, result discarded if not smaller. **No request-body decompression exists**, so decompression-bomb surface is N/A.

### ZH-016 · Medium (verified safe) · CWE-614 · cookies

All attributes supported (HttpOnly/Secure/SameSite/Domain/Path/Max-Age/Expires/Partitioned/Priority); HMAC-SHA256 signing with `timingSafeEqual`; empty secret rejected when signing; name/value/path/domain grammar-validated (value validated _after_ encoding, defeating custom-encoder smuggling); multi-secret rotation on verify. Regression: `test/security/cookie-security.test.ts`.

### ZH-017 · Medium (verified safe) · errors

Default error responder returns `{ error: "Internal Server Error" }` for 5xx with no stack/path/message; 4xx surface only the framework-authored message. Status-gated (stronger than an env flag). Regression: `test/security/error-disclosure.test.ts`.

### ZH-018 · Medium (verified safe) · methods

TRACE/CONNECT not registrable and TRACE does not echo the request; no `X-HTTP-Method-Override`; HEAD mirrors GET without a body. Regression: `test/security/http-methods.test.ts`.

### ZH-011 / ZH-012 / ZH-023 · Not applicable

No multipart parser, no `upgrade`/WebSocket handling, no HTTPS/TLS server creation (`http.createServer` only; `req.protocol`/`req.secure` are read-only detection). Documented: terminate TLS at a reverse proxy or wrap with `node:https`; multipart/WebSocket are out of scope by design (see non-goals).

### ZH-015 (request side) · Not applicable

No `zlib` decompression of request bodies anywhere in `lib/`; documented so operators know request bodies are never auto-inflated.

---

## 4. Supply chain (Phase 5)

- **ZH-024 secrets:** no hardcoded secrets. The only `.env` is a test fixture (`API_KEY=should-not-be-served`) used to prove dotfiles are never served; it is **not** in the publish tarball.
- **ZH-025 deps:** `dependencies`/`optional`/`peer` all empty; `npm audit --omit=dev` → **0 vulnerabilities**.
- **ZH-026 package:** `files: ["dist"]`; tarball = 6 files (LICENSE, README, `dist/index.{js,d.ts,js.map}`, package.json) — no tests, fixtures, `.env`, keys, HISTORY/CLAUDE. No `preinstall`/`install`/`postinstall` scripts (only `prepack` builds).
- **ZH-027 CI:** `ci.yml` `permissions: contents: read`; `release.yml` `contents: write` (GitHub Release) + `id-token: write` (OIDC provenance) — both minimal and justified; publishing is OIDC Trusted Publishing (no long-lived token). Actions pinned to `@v4`. _Optional future hardening: pin actions to full commit SHAs._

## 5. Testing infrastructure (Phase 6)

- **ZH-028 fuzz:** seeded (mulberry32) property/fuzz suites exist for the query parser (`test/fuzz/query.fuzz.ts`, ×3 seeds ×10k), serializer (`test/fuzz/serialize.fuzz.ts`), and the cookie parser (2k-case differential fuzz). No runtime dep added; `fast-check` remains an optional future devDep.
- **ZH-029 security suite:** `test/security/` — 16 files, 78 tests, covering every confirmed vulnerability and every verified-safe finding.

---

## 6. Release checklist

- [x] Static file traversal fixed (ZH-001)
- [x] Symlink traversal tested
- [x] Request timeout configured (ZH-004)
- [x] Header timeout configured
- [x] Keep-alive timeout reviewed
- [x] Body limits tested (ZH-005)
- [x] Query parser tested (ZH-006)
- [x] Prototype pollution tested (ZH-003)
- [x] Header injection tested (ZH-007)
- [x] Cookie security tested (ZH-016)
- [x] Proxy trust tested (ZH-013)
- [x] Redirect behavior tested (ZH-014)
- [x] Host header tested (ZH-008)
- [x] HTTP request smuggling tested (ZH-002)
- [x] Router security tested (ZH-009)
- [x] Regex DoS reviewed (ZH-010)
- [x] Compression reviewed (ZH-015)
- [x] Multipart reviewed — documented absent (ZH-011)
- [x] WebSocket reviewed — documented absent (ZH-012)
- [x] TLS reviewed — documented absent (ZH-023)
- [x] Null-byte handling fixed + tested (ZH-020)
- [x] Security-headers middleware added (ZH-022)
- [x] Secrets scanned (ZH-024)
- [x] npm package contents reviewed (ZH-026)
- [x] npm lifecycle scripts reviewed
- [x] GitHub Actions permissions reviewed (ZH-027)
- [x] `npm audit` completed (0 vulns, prod)
- [x] Security tests passing (78)
- [x] Existing test suite passing (1017 pass / 1 skip / 0 fail)
- [x] TypeScript build passing
- [x] Lint passing (CI; local CRLF-only artifact from core.autocrlf)
- [x] Documentation updated (README security section, SECURITY.md, this report)
- [x] SECURITY.md present
- [x] Changelog updated

## 7. Conditions (for production deployment)

1. Set `trustProxy` **only** when actually behind a trusted reverse proxy/LB, and to the narrowest form (hop count or CIDR), never `true` on a directly-exposed server.
2. Use `{ httpOnly: true, secure: true, sameSite: "lax" }` for session cookies and a strong `cookieSecret`.
3. Validate any **user-supplied** redirect destination in application code (ZH-014).
4. Add `app.use(securityHeaders())` (and a `Content-Security-Policy` suited to your app).
5. Terminate TLS at a proxy or `node:https`; keep the pinned timeouts (or tighten them) for direct-internet exposure.

---

## 8. Final Recommendation

# APPROVED WITH CONDITIONS

No confirmed Critical or High severity, remotely-exploitable vulnerability remains open: the one Critical (ZH-001 symlink escape) and the one High injection (ZH-020 null byte) are fixed with fail-pre/pass-post regression tests, and the timeout/header hardening is in place. The "conditions" above are deployment and documentation guidance, not unresolved code defects. Safe to publish.
