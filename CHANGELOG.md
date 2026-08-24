# Changelog

All notable changes to `zonix-http`. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/) (0.x: minor may break).

## [Unreleased] — 0.2.0

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
