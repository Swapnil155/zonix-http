# Changelog

All notable changes to `zonix-http`. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/) (0.x: minor may break).

## [Unreleased]

## [0.3.0] — 2026-08-25

Source-level security audit (findings ZH-001…ZH-029; full report in
`docs/security/audit-report.md`). Verdict: **APPROVED WITH CONDITIONS**.

### Security

- **Static symlink escape fixed (ZH-001, Critical, CWE-59):** `serveStatic` now
  `realpath`-validates every served file (direct, cache, and index paths)
  against the real root, so a symlink/junction inside the root pointing outside
  it returns 403 instead of leaking the target. **Consumer impact:** a
  previously-served path that escaped the root via a symlink is now a 403;
  legitimate files (including legitimately symlinked files whose target is
  inside the root) are unaffected. Adds one `realpath` syscall per served file.
- **Route-param null byte rejected (ZH-020, High, CWE-158):** a `%00` in a
  decoded path segment is now a 400 instead of reaching handlers as a literal
  NUL. **Consumer impact:** a request path containing `%00` now returns 400.

### Added

- **Configurable slow-client timeouts (ZH-004, CWE-400):** the server pins
  version-stable defaults — `headersTimeout` 60s, `requestTimeout` 300s,
  `keepAliveTimeout` 5s — each overridable via `zonix({ headersTimeout,
requestTimeout, keepAliveTimeout })` (`0` disables). **Consumer impact:**
  timeouts are now identical across Node versions; on Node 18+ this matches the
  runtime's own defaults, so no behavior change for typical requests.
- **`securityHeaders()` middleware (ZH-022):** new opt-in, zero-dependency
  middleware. Safe defaults (`X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`)
  on as soon as it is added; CSP / HSTS / Permissions-Policy off until given a
  value; HSTS never emitted on plaintext; never overrides a header a handler
  already set.
- **Stricter header validation (ZH-007, CWE-93/113):** `res.set`/`header`/
  `append`/`links` now reject every control character (not just CR/LF/NUL) in
  values and validate the header name as an RFC 7230 token. **Consumer impact:**
  a header value containing other control characters, or a malformed header
  name, now throws a framework error instead of relying on Node's backstop; the
  accepted set equals Node's own, so valid headers are unaffected.
- `test/security/` — 16 files, 78 regression tests covering every confirmed
  vulnerability and verified-safe finding.

### Verified safe (no code change, regression-locked)

Request smuggling, prototype pollution across all parsers, body-size
exhaustion, query-parser limits, host-header trust, ReDoS, proxy trust, cookie
security, error non-disclosure, and HTTP-method handling were each audited and
confirmed safe, with regression tests added.

### Docs

- New consumer-facing **Security & deployment** section in the README
  (shared-responsibility model, `trustProxy`, session cookies, open-redirect
  avoidance, `securityHeaders()`, TLS termination, timeouts, resource limits,
  and an explicit "what zonix-http does not do" list).
- `SECURITY.md` updated with the new guards and deployment guidance;
  `docs/security/audit-report.md` and `docs/security/recon.md` added.

## [0.2.0] — 2026-08-24

### Added

- **`req.signedCookies`** — `cookieParser()` now verifies `s:`-signed cookies
  (HMAC-SHA256, `cookie-signature` wire format). A valid signature moves the
  value to `req.signedCookies`; a tampered one becomes `false` there; either
  way it leaves `req.cookies`. Secrets come from the app's `cookieSecret` or
  an explicit `cookieParser(secret)` argument; an array enables rotation.
  Semantics differentially tested against `cookie-parser@1.4.7` (two
  documented deviations: a cookie literally named `__proto__` is kept as
  inert data on the null-prototype map where cookie-parser drops it; an
  empty cookie name is dropped where cookie-parser keeps it).
- **`j:` JSON cookies** revive on parse in both maps, completing the round
  trip `res.cookie("user", { id: 1 })` already wrote.
- **`serveStatic` browser caching** — new `maxAge` (milliseconds or `"30s"`,
  `"12h"`, `"7d"`, `"1y"`; clamped to one year) and `immutable` options emit
  `Cache-Control: public, max-age=…[, immutable]` on 200, 206 and 304
  responses, byte-identical to `express.static`. Off unless set — zonix
  keeps its send-nothing-by-default posture (Express sends `max-age=0`).

## [0.1.2] — 2026-08-24

### Changed

- Release pipeline publishes via npm OIDC Trusted Publishing — no token
  secret anywhere. No code changes.

## [0.1.1] — 2026-08-24

### Changed

- README: full guide (eight feature areas, every snippet executed against
  the library) and performance recipes. No code changes.

## [0.1.0] — 2026-08-24

### Added

- Initial release: Express-compatible zero-dependency HTTP framework —
  radix router with mounting, middleware + 4-arity error handling, body
  parsers (json/urlencoded/raw/text, byte-exact 413s), static files with
  ETag/304/206/compression and opt-in memory cache, signed-cookie writing,
  content negotiation, schema serializer, trust proxy. 894 tests; provenance
  publish from CI on Node 20/22/24.
