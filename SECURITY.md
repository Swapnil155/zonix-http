# Security Policy

## Reporting a vulnerability

Email **swapnilbendal155@gmail.com** with `[zonix security]` in the subject.
Please do not open a public issue for anything exploitable. Include the
affected version, a minimal reproduction (a raw request is ideal), and the
impact as you understand it. You will get an acknowledgement within 72 hours
and a fix or a written assessment within 14 days; credit is given in the
release notes unless you ask otherwise. Once the repository is public, GitHub
private vulnerability reporting will be accepted as an equivalent channel.

Supported: the latest 0.x minor. Earlier minors receive no backports.

## Threat model

zonix is an HTTP application framework. It assumes the **application code is
trusted** and **every byte on the wire is hostile**: request line, headers,
path, query string, cookies and body. The framework's job is to make sure a
hostile request cannot

- pollute `Object.prototype` or any shared object via developer-visible
  request data (`req.params`, `req.query`, `req.body`, `req.cookies`);
- read a file outside a `serveStatic` root or a dotfile inside it;
- inject a response header or split a response through any framework API
  that puts attacker-influenced strings into headers;
- exhaust memory or CPU with oversized or deeply nested input (parsers are
  byte-counted and linear; no backtracking regexes anywhere in the tree);
- crash the process by disconnecting at an inconvenient moment.

Out of scope: bugs in application handlers, TLS (terminate in front of
zonix or use `node:https` directly), HTTP request smuggling and header-size
limits (owned by `node:http`; zonix does not loosen its defaults), and
denial-of-service by sheer volume. zonix has **zero runtime dependencies**,
so there is no transitive supply chain to report against — every parser it
ships is implemented in `lib/` and differentially tested against the pinned
original it replaces.

## Guards

Each line below is enforced by a committed test; names in brackets point at
the suite.

### Limits

- Body parsers: `json` defaults to `1mb`, `urlencoded` / `raw` / `text` to
  `100kb`; the limit counts **bytes, not characters**, and is exact — at the
  limit passes, one byte over is a 413 [`test/body/json.test.ts`,
  `test/body/parsers.test.ts`]. A `Content-Length` above the limit is refused
  before a byte is read.
- Route parameters: a decoded named capture longer than `maxParamLength`
  (default 100) is a 414 before any handler runs, inside mounted routers too
  [`test/core/mount.test.ts`].
- Extended query / urlencoded: nesting depth capped (5 for `req.query`, 32
  for bodies — a 400 past it), sparse-array guard (`arrayLimit`), and a
  parameter count cap (1000 — a 413 when exceeded in a body)
  [`test/query/extended.test.ts`, `test/body/parsers.test.ts`, plus a
  10,000-input fuzz loop with a linear-time cap in `test/fuzz/query.fuzz.ts`].
- Character sets outside UTF-8 / Latin-1 / ASCII / UTF-16LE are a 415 before
  the body is read; no transcoding library is ever loaded.
- Header size is Node's own `maxHeaderSize`. Slow-client timeouts are **pinned
  to safe, version-stable defaults** and are configurable: `headersTimeout`
  60s, `requestTimeout` 300s, `keepAliveTimeout` 5s (each overridable via
  `zonix({ headersTimeout, requestTimeout, keepAliveTimeout })`; `0` disables).
  This bounds the slow-header, slow-body and idle-keep-alive slowloris
  dimensions regardless of the Node version's own defaults
  [`test/security/request-timeout.test.ts`].

### Oversized bodies are answered, never reset

A body that overflows **mid-stream** — chunked, dribbled, or multibyte split
across chunks — gets a real `413` response with `Connection: close`; the
request is paused so the excess is never buffered, and the client receives
the status instead of a bare socket reset
[`test/body/json-equivalence.test.ts`: "one byte over is a 413 that the
client receives", "overflows mid-stream is a 413, not a reset"]. Every
framework-generated error response carries `Connection: close`
[`test/core/errors.test.ts`].

### Path traversal

`serveStatic` decodes the path, rejects NUL bytes (403), **resolves first and
then proves the result is still inside the root** — so `..`, percent-encoded
and double-encoded forms, and backslash separators are all caught by the same
check (403). It then **`realpath`-validates the actual file against the real
root**, so a symlink (or Windows junction) inside the root that points outside
it can never leak a file: the escaped path is a 403, not the target's contents
(CWE-59) [`test/security/static-symlink.test.ts`]. Dotfile segments (`.env`,
`.git/config`) fall through to the next handler by default; `dotfiles: "allow"`
is the explicit opt-in. Malformed percent-encoding in a route path is a 400,
and a **NUL byte (`%00`) in any decoded route param is a 400** so it can never
truncate a downstream filesystem operation (CWE-158)
[`test/middleware/serve-static.test.ts`, `test/security/router-security.test.ts`].

### Prototype pollution

- `req.query` and `req.cookies` are **null-prototype** objects; a `__proto__`
  key is plain data [`test/compat/request.test.ts`, `test/cookies/parse.test.ts`].
- The extended query parser drops every segment that is an own property of
  `Object.prototype` (`__proto__`, `constructor`, `hasOwnProperty`, …) and
  `prototype` itself, at any depth, and returns null-prototype objects
  [`test/query/extended.test.ts`, fuzzed].
- `req.params` is a plain object whose keys are _developer_ route patterns;
  registering `:__proto__`, `:constructor` or `:prototype` throws at
  registration time, so an attacker never controls a key.
- A polluted `Object.prototype` cannot hijack cookie-value encoding
  [`test/compat/response.test.ts`].

### Header injection / CRLF

- `res.set`, `res.append` and every helper built on them reject **any control
  character** (CR/LF/NUL and every other C0 control except HTAB, plus DEL) in
  header values, and reject a header **name** that is not a valid RFC 7230
  token, before they reach `node:http`
  [`test/security/header-injection.test.ts`, `test/compat/response.test.ts`].
- `res.location` / `res.redirect` percent-encode CRLF instead of splitting the
  response.
- Cookie names, values, paths and domains are validated against the
  cookie-octet grammar; an injected attribute throws
  [`lib/cookies/serialize.ts`].
- `Content-Disposition` filenames are quoted/encoded so CRLF cannot break
  out of the header [`test/http/content-disposition.test.ts`].
- Signed cookies use HMAC-SHA256 compared with `timingSafeEqual`.

### Parsers

No `eval`, no `new Function`, no generated code; no regular expression with
nested quantifiers. Accept-* negotiation, ranges, ETags, cookies and query
strings are all linear scanners, each differentially tested against the
original package it replaces.

### Opt-in security headers

`securityHeaders()` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin` and `X-Frame-Options: DENY` on every response,
and — only when you give them a value — `Content-Security-Policy`,
`Strict-Transport-Security` (never on plaintext) and `Permissions-Policy`.
Nothing auto-enables that could break a working app
[`test/security/security-headers.test.ts`].

## Deployment guidance (secure by default, hardened by configuration)

- **Trust proxy** is **off by default** — turn it on (`zonix({ trustProxy })`)
  only behind a reverse proxy/LB you control, and prefer the narrowest form (a
  hop count or specific CIDR) over `true`. Misuse makes `req.ip`,
  HTTPS detection, and any IP-based logic spoofable.
- **Session cookies:** `res.cookie(name, v, { httpOnly: true, secure: true, sameSite: "lax", signed: true })`
  with a strong `cookieSecret`.
- **Redirects to user-supplied URLs:** validate the destination in your handler
  (allowlist / same-origin). zonix redirects where you tell it and neutralizes
  CRLF, but does not decide whether a destination is safe (CWE-601).
- **TLS:** terminate at a proxy or wrap with `node:https`; keep (or tighten) the
  pinned slow-client timeouts for direct-internet exposure.
- Add `app.use(securityHeaders())` with a `Content-Security-Policy` for your app.

The full source-level audit — findings ZH-001…ZH-029, fixes, and the verdict —
is in [`docs/security/audit-report.md`](docs/security/audit-report.md).

## Disclosure practice

Security fixes ship as a patch release with a `GHSA`/CVE reference where one
exists, a changelog entry describing the impact plainly, and the regression
test that now guards it.
