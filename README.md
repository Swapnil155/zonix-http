# zonix-http

A zero-dependency, Express-compatible HTTP framework for Node.js.

`npm install` brings in **one package, ~116 KB** — no dependency tree, no
transitive CVEs, nothing to audit but this repository. The API is Express's:
middleware `(req, res, next)`, routers, `res.send/json/sendFile`, signed
cookies, static files with caching/ETags/ranges/compression. A real Express app
has been ported by changing **only the import line** — the wire output was
byte-identical across a 41-request test corpus.

- **Zero runtime dependencies** — `node:` builtins only.
- **TypeScript strict, ESM, Node ≥ 20** — tested on Node 20, 22 and 24.
- **1,000+ tests**, ≥ 90% enforced coverage on `lib/`, plus differential tests
  against the original packages each inlined module replaces (qs, negotiator,
  fresh, range-parser, etag, compression, cookie-signature, type-is…).
- **Secure by default** — see [Security](#security): null-prototype request
  data, byte-accurate limits, symlink-safe static serving, CRLF-rejecting header
  writes, timing-safe signed cookies, no `eval`/codegen/backtracking regex.
- **Fast** — measured, with the harness in-repo so you can rerun everything
  ([numbers below](#performance)).

## Install

```sh
npm install zonix-http
```

## Quick start

```ts
import zonix from "zonix-http";

const app = zonix();

app.use(zonix.json());

app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id, verbose: req.query.verbose === "1" });
});

app.post("/users", (req, res) => {
  res.status(201).json({ created: req.body });
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(3000, () => console.log("http://localhost:3000"));
```

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Routing](#routing)
- [Middleware](#middleware)
- [Request](#request)
- [Response](#response)
- [Body parsing](#body-parsing)
- [Query parsing](#query-parsing)
- [Cookies](#cookies)
- [Static files](#static-files)
- [Compression](#compression)
- [Reverse proxy and trustProxy](#reverse-proxy-and-trustproxy)
- [Error handling](#error-handling)
- [Security](#security)
- [Beyond the HTTP core](#beyond-the-http-core)
- [Performance](#performance)
- [Express compatibility](#express-compatibility)
- [Contributing](#contributing)
- [Reporting a vulnerability](#reporting-a-vulnerability)
- [License](#license)

## Routing

```ts
app.get("/posts/:slug", (req, res) => {
  res.json({ slug: req.params.slug });
});

app.get("/files/*", (req, res) => {
  // wildcard capture is req.params["*"]
  res.send(`you asked for ${req.params["*"]}`);
});

app.all("/admin/*", requireAuth); // every method
```

Static segments beat params, params beat wildcards — `/posts/new` wins over
`/posts/:slug`. Registering the same route twice throws at startup instead of
shadowing silently. `HEAD` falls back to a matching `GET` unless an explicit
`HEAD` route exists.

Routers group and mount routes, nesting arbitrarily deep with correct
`baseUrl`/`originalUrl`:

```ts
import zonix from "zonix-http";

const users = zonix.Router();
users.get("/", (req, res) => res.json({ list: true }));
users.get("/:id", (req, res) => {
  // req.baseUrl === "/api/users", req.originalUrl === the full path
  res.json({ id: req.params.id });
});

const app = zonix();
app.use("/api/users", users);
```

## Middleware

Middleware is the Express signature `(req, res, next)`. Register it with
`app.use(fn)` or scope it to a path prefix with `app.use(path, fn)`; pass
middleware before a route handler to run it for that route only.

```ts
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

// async handlers just work — a rejection reaches your error middleware
app.get("/data", async (req, res) => {
  const rows = await db.query();
  res.json(rows);
});
```

> **One deliberate difference from Express:** every `app.use()` runs **before
> any route**, in registration order — a `use()` written after a route still
> applies to it. See [Express compatibility](#express-compatibility).

## Request

`req` extends Node's `IncomingMessage`, so `req.method`, `req.url`, and
`req.headers` are all there, plus the Express accessors (lazy — an accessor you
never read costs nothing):

| Property                                       | What it is                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `req.params`                                   | Route parameters (plain object)                                             |
| `req.query`                                    | Parsed query string (null-prototype; see [Query parsing](#query-parsing))   |
| `req.body`                                     | Set by a body parser; `undefined` until one runs, `{}` when a parser skips  |
| `req.cookies` / `req.signedCookies`            | Populated by `cookieParser()` (see [Cookies](#cookies))                     |
| `req.path` / `req.originalUrl` / `req.baseUrl` | Path without query; full original URL; the mount prefix                     |
| `req.ip` / `req.ips`                           | Client address, trust-proxy aware                                           |
| `req.host` / `req.hostname` / `req.subdomains` | Host (with port) / host (port stripped) / subdomain labels                  |
| `req.protocol` / `req.secure` / `req.xhr`      | `"http"`/`"https"`, TLS boolean, `X-Requested-With` check                   |
| `req.fresh` / `req.stale`                      | Conditional-request freshness against `If-None-Match` / `If-Modified-Since` |

Methods: `req.is(type)` (returns the matched type or `false`), `req.accepts(...)`,
`req.acceptsEncodings/Charsets/Languages(...)`, and `req.range(size)`.

```ts
app.get("/things", (req, res) => {
  if (req.accepts("json") === false) return res.sendStatus(406);
  res.json({ ip: req.ip, page: req.query.page, wantsJson: req.is("json") });
});
```

## Response

| Call                                                                | Effect                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------- |
| `res.status(code)`                                                  | Set the status code (chainable)                       |
| `res.send(body)`                                                    | String → HTML, `Buffer` → octet-stream, object → JSON |
| `res.json(data)`                                                    | JSON with `Content-Length`                            |
| `res.sendStatus(code)`                                              | Set status and send its standard message              |
| `res.type(t)`                                                       | Set `Content-Type` from a MIME or extension           |
| `res.set(field, val)` / `res.get(field)` / `res.append(field, val)` | Read/write response headers (CRLF-rejecting)          |
| `res.cookie(name, val, opts)` / `res.clearCookie(name, opts)`       | Write / expire a cookie (see [Cookies](#cookies))     |
| `res.redirect([code,] url)` / `res.location(url)`                   | Redirect / set `Location` (CRLF-neutralized)          |
| `res.format({ ... })`                                               | Content negotiation by `Accept`                       |
| `res.sendFile(path)`                                                | Stream a file with MIME, `Content-Length`, ranges     |
| `res.attachment(name)` / `res.links({ ... })` / `res.vary(field)`   | `Content-Disposition` / `Link` / `Vary`               |
| `res.locals`                                                        | Per-request data bag for your handlers                |

```ts
app.get("/report", (req, res) => {
  res.format({
    "application/json": () => res.json({ report: true }),
    "text/html": () => res.send("<h1>Report</h1>"),
    default: () => res.sendStatus(406),
  });
});
```

`res.send(number)` throws (with a pointer to `res.sendStatus`) rather than
sending the number as a body — see [Express compatibility](#express-compatibility).

## Body parsing

```ts
app.use(zonix.json({ limit: "1mb" }));
app.use(zonix.urlencoded({ extended: true, limit: "100kb" }));
app.use(zonix.text());
app.use(zonix.raw({ type: "application/octet-stream" }));

app.post("/echo", (req, res) => res.json(req.body));
```

Limits are byte-exact; an oversized body is answered with a real `413` and
`Connection: close`, never a dropped socket. A request the parser skips (no
body, other content-type) leaves `req.body = {}`. Charsets outside
UTF-8/Latin-1/ASCII/UTF-16LE are a `415` — no transcoding library is loaded.

## Query parsing

The default parser is **simple**: `?a=1&b=2` becomes flat string pairs through
an allocation-light scanner (Express 5's default). Opt into **extended** parsing
for nested-bracket shapes:

```ts
const app = zonix({ queryParser: "extended" }); // or app.set("query parser", "extended")

// GET /search?filter[status]=active&filter[age]=30
app.get("/search", (req, res) => {
  res.json(req.query); // { filter: { status: "active", age: "30" } }
});
```

`req.query` is always a **null-prototype** object, so a `__proto__` key is inert
data. Extended parsing enforces depth, array-length, and parameter-count caps to
bound cost, and drops any `Object.prototype` key at every depth.

## Cookies

```ts
import zonix, { cookieParser } from "zonix-http";

const app = zonix({ cookieSecret: process.env.COOKIE_SECRET });
app.use(cookieParser());

app.get("/login", (req, res) => {
  res.cookie("theme", "dark");
  res.cookie("session", "user42", { signed: true, httpOnly: true });
  res.json(req.cookies); // null-prototype: a "__proto__" cookie is inert data
});

app.get("/me", (req, res) => {
  // Verified server-side: a tampered signature reads back as `false`,
  // never as the attacker's value.
  const session = req.signedCookies.session;
  if (session === false || session === undefined) return res.sendStatus(401);
  res.json({ user: session });
});
```

Signed cookies are HMAC-SHA256, wire-compatible with Express's
`cookie-signature` format, and verified with a constant-time compare. Always
pair a session cookie with `httpOnly: true` (no JavaScript access — XSS cannot
steal it), and add `secure: true` in production so it only travels over HTTPS.
See [Cookies & sessions](#cookies--sessions) for the hardened set and secret
rotation.

## Static files

```ts
app.use(zonix.static("./public"));
// browser caching for fingerprinted assets (Cache-Control: public, max-age=..., immutable):
app.use(zonix.static("./assets", { maxAge: "1y", immutable: true }));
// dotfiles are never served unless you opt in:
app.use(zonix.static("./public", { dotfiles: "allow" }));
```

ETags, 304s, byte ranges/206 and gzip/deflate/brotli negotiation are built in;
a miss calls `next()` so your routes still run. Every served file is
`realpath`-validated against the root, so a symlink pointing outside the root
can never leak its target. An opt-in in-memory cache is the biggest win for
asset-heavy apps:

```ts
app.use(zonix.static("./public", { cache: { maxBytes: 8 * 1024 * 1024 } }));
```

LRU by bytes; every hit revalidates against the file's mtime with one `stat()`,
so an edited file is never served stale. 304s, ranges and compression all work
on top of the cached bytes.

## Compression

Response compression is opt-in middleware. It negotiates gzip/deflate/brotli
against the client's `Accept-Encoding`, computes the ETag on the raw body, and
never compresses a `206 Partial Content` response:

```ts
import zonix, { compression } from "zonix-http";

const app = zonix();
app.use(compression());
```

It is plan-based: the middleware installs a plan and the response senders
(`res.send`, `res.json`, `res.sendFile`) consult it, so unused responses pay
nothing. `zonix.static()` negotiates the same encodings for files on its own.

## Reverse proxy and trustProxy

`trustProxy` is **off by default**: `req.ip`, `req.protocol`, `req.secure`, and
`req.hostname` come from the socket, and no `X-Forwarded-*` header can influence
them. Turn it on **only** when a proxy you control sits in front, and scope it
as tightly as possible:

```ts
const app = zonix({ trustProxy: 1 }); // trust exactly one hop (a single nginx/ALB)
// or a specific network:            zonix({ trustProxy: "10.0.0.0/8" })
// or via the settings API:          app.set("trust proxy", 1)
```

With it on, `X-Forwarded-Proto` sets `req.protocol`/`req.secure` and
`X-Forwarded-For` sets `req.ip`/`req.ips`. Misusing it while directly
internet-exposed lets any client spoof those values — see
[Reverse proxies & client IP](#reverse-proxies--client-ip--trustproxy) in
Security for the threat model.

## Error handling

A **4-arity** middleware is the error handler. `next(err)`, a synchronous
`throw`, and a rejected async handler all route to it through one central
dispatcher:

```ts
app.get("/data", async (req, res) => {
  const rows = await db.query(); // a rejection here is caught for you
  res.json(rows);
});

// (err, req, res, next) — runs for next(err), throws, and rejections
app.use((err, req, res, next) => {
  if (res.headersSent) return; // response already on the wire — guard this
  res.status(err.status ?? 500).json({ error: err.message });
});
```

An unmatched request gets a default JSON `404`; replace it with
`app.fallback(handler)`. A single central handler can also be registered with
`app.handleErr(handler)`. In production, error responses never leak stack
traces, paths, or internals.

## Security

zonix-http is built to be safe by default and Express-compatible. A few security
properties, though, depend on **how you deploy and configure** it — the framework
can't choose them for you without either breaking compatibility or guessing wrong
about your environment. This section covers those.

> Examples use zonix-http's documented option names. If your setup wires them
> differently, keep the **settings**; adjust the syntax.

### Shared responsibility

**zonix-http handles for you**

- Parsers that can't be prototype-polluted (null-prototype, key-filtered)
- Byte-accurate body-size limits (the declared `Content-Length` can't lie its way past the cap)
- Symlink-safe static file serving (real-path validated; no escape outside the root)
- Header/response writes that reject CR/LF/NUL and control characters (no header injection)
- Timing-safe, HMAC-signed cookies
- Slow-client timeouts (slowloris resistance, independent of Node version)
- Errors that don't leak stack traces, paths, or internals in production
- Linear-time routing/parsing (no catastrophic-regex DoS)

**You must configure (this section)**

- `trustProxy` — only when you're behind a proxy you control
- Cookie flags for sessions
- Redirect destination validation
- Security headers / CSP
- TLS termination

### Production checklist

- [ ] `trustProxy` set to the **narrowest** form (hop count or CIDR) — never `true` when directly internet-exposed
- [ ] Session cookies: `{ httpOnly: true, secure: true, sameSite: 'lax', signed: true }` + a strong `cookieSecret`
- [ ] Any redirect built from user input is **allowlisted** in app code
- [ ] `app.use(securityHeaders())` with a CSP tuned to your app
- [ ] TLS terminated at a proxy or `node:https`; pinned timeouts kept or tightened
- [ ] Body/query limits reviewed against what your endpoints actually accept

---

### Reverse proxies & client IP — `trustProxy`

By default `trustProxy` is **off**, so `req.ip`, `req.protocol`, and `req.hostname`
come from the socket and forwarded headers are ignored. That's the safe default: if
you enabled trust while directly exposed, any client could spoof `X-Forwarded-For`
to forge `req.ip` (defeating IP allowlists, rate limits, and audit logs) or
`X-Forwarded-Proto` to fake HTTPS.

Turn it on **only** when a proxy you control sits in front, and scope it as tightly
as possible so a client can't inject extra hops:

```js
import zonix from "zonix-http";

// Trust exactly one proxy hop (e.g. a single nginx/ALB in front):
const app = zonix({ trustProxy: 1 });

// Or trust a specific proxy network only:
const app = zonix({ trustProxy: "10.0.0.0/8" });
```

Never use `trustProxy: true` on a service reachable directly from the internet.

### Cookies & sessions

The framework keeps Express-compatible cookie defaults so it doesn't break local
HTTP development. For **authentication/session** cookies, opt into the hardened set
explicitly:

```js
res.cookie("session", token, {
  httpOnly: true, // not readable from JS → XSS can't exfiltrate the session
  secure: true, // only sent over HTTPS → never exposed on a plaintext hop
  sameSite: "lax", // withheld on cross-site requests → CSRF mitigation
  signed: true, // HMAC-signed → tampering is detected and rejected
  path: "/",
  maxAge: 1000 * 60 * 60 * 8, // 8h
});
```

Signed cookies require a strong secret — 32+ random bytes, from the environment,
never hard-coded:

```js
const app = zonix({ cookieSecret: process.env.COOKIE_SECRET });
```

Rotate secrets on the read side with `cookieParser`: pass an array and each
incoming cookie is verified against every secret in turn, so cookies signed with a
retired secret keep validating while new cookies are signed with the current
`cookieSecret`.

```js
import zonix, { cookieParser } from "zonix-http";

const app = zonix({ cookieSecret: process.env.COOKIE_SECRET }); // signs new cookies
app.use(cookieParser([process.env.COOKIE_SECRET, process.env.OLD_SECRET])); // verifies both
```

### Redirects — avoiding open redirects

`res.redirect` sends wherever you tell it. Handing it raw user input is a classic
open redirect (CWE-601): an attacker sends `?url=https://evil.example`, your domain
issues the redirect, and the victim trusts it because it came from you. The
framework can't allowlist for you — only your app knows which destinations are
legitimate.

```js
// ❌ Open redirect
app.get("/go", (req, res) => res.redirect(String(req.query.url)));

// ✅ Allowlist known paths; fall back to a safe default
const ALLOWED = new Set(["/dashboard", "/settings", "/"]);
app.get("/go", (req, res) => {
  const to = String(req.query.url || "");
  res.redirect(ALLOWED.has(to) ? to : "/");
});
```

If you must allow arbitrary same-origin paths, accept only values starting with a
single `/` (reject `//host` and `/\host`, which are protocol-relative escapes), and
never accept a full URL from the client.

### Security headers — `securityHeaders()`

Response security headers aren't on by default, because a strict policy (especially
CSP) breaks apps until it's tuned to what they load. Enable the opt-in middleware
and add a CSP for your app:

```js
import zonix, { securityHeaders } from "zonix-http";

app.use(
  securityHeaders({
    contentSecurityPolicy: "default-src 'self'",
    strictTransportSecurity: "max-age=15552000; includeSubDomains", // 180 days
  }),
);
```

Defaults that are safe everywhere are **on** as soon as you add it:
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`. The policies that need tuning — CSP, HSTS, Permissions-Policy —
stay **off** until you configure them. HSTS is only emitted over HTTPS (never on a
plaintext response, so you can't accidentally lock users out), and the middleware
never overrides a header a route handler already set.

### TLS / HTTPS

zonix-http serves **HTTP**; it deliberately ships no TLS server and no custom
crypto. Terminate TLS at a reverse proxy (preferred) or wrap the app's request
listener with Node's built-in HTTPS — both are shown, with the settings caveat,
in [Beyond the HTTP core → HTTPS / TLS](#c-https--tls):

```js
// Preferred: terminate at a reverse proxy (nginx, Caddy, ALB) in front of the app.
const app = zonix({ trustProxy: 1 }); // proxy sets X-Forwarded-Proto: https
```

Behind a proxy, make sure it sets `X-Forwarded-Proto` and that `trustProxy` is on,
so `req.protocol` and `req.secure` (and therefore `secure` cookies) are correct.

### Timeouts & slow-client protection

The server ships pinned, version-stable timeouts so slowloris resistance doesn't
depend on the Node release. Keep them, or tighten for your workload; set a value to
`0` to disable that one:

```js
const app = zonix({
  requestTimeout: 300_000, // whole-request deadline
  headersTimeout: 60_000, // time allowed to send headers
  keepAliveTimeout: 5_000, // idle keep-alive socket lifetime
});
```

Sockets are released on timeout, client disconnect, and aborted requests.

### Request size & resource limits

Body parsers cap the true received bytes (not the client-declared length) and return
`413` past the limit. Set limits to the smallest value each endpoint actually needs:

```js
import zonix from "zonix-http";

app.use(zonix.json({ limit: "100kb" }));
app.use(zonix.urlencoded({ limit: "100kb", extended: true }));
```

The extended query parser also enforces depth, array-length, and parameter-count
limits by default to bound parsing cost — leave these on.

### What zonix-http does not do

So you don't assume protection that isn't there. Each has a worked example in
[Beyond the HTTP core](#beyond-the-http-core):

- **No multipart/`form-data` parser** — file uploads are not handled; add a dedicated,
  limit-enforcing parser ([uploads](#a-file-uploads-multipartform-data)).
- **No WebSocket / upgrade handling** — bring your own WS layer
  ([realtime](#b-websockets--realtime)).
- **No built-in TLS server** — terminate TLS at a proxy or `node:https`
  ([HTTPS / TLS](#c-https--tls)).
- **No automatic request-body decompression** — a `Content-Encoding: gzip` request
  body is not silently inflated (which also means no decompression-bomb surface);
  handle it explicitly ([compressed request bodies](#d-compressed-request-bodies)).

## Beyond the HTTP core

zonix-http is a minimal HTTP core. Uploads, realtime, TLS, and compressed request
bodies are handled at the app/infrastructure layer with standard tools — the same
split Express uses, which is exactly what keeps the audited surface small. Each
example below is verified by a runnable script in
[`examples/`](./examples) (`cd examples && npm install && npm run verify`).

### (a) File uploads (multipart/form-data)

Parse the multipart stream at the route with **busboy**, enforce hard caps, and
sanitize the filename before it ever touches disk. Do **not** put `zonix.json()`
or `zonix.urlencoded()` on an upload route — they'd try to buffer the multipart
body; busboy consumes the raw stream instead. (`multer` is the higher-level
option if you'd rather not wire the events yourself.)

```js
import zonix from "zonix-http";
import busboy from "busboy";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";

// basename() drops any directory portion; still reject a NUL byte and an empty result.
function safeName(raw) {
  const name = basename(String(raw));
  if (name.length === 0 || name.includes("\0") || name === "." || name === "..") return null;
  return name;
}

app.post("/upload", (req, res) => {
  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 }, // the caps ARE the protection
  });
  let aborted = false;
  const fail = (status, message) => {
    if (aborted) return;
    aborted = true;
    req.unpipe(bb);
    res.status(status).json({ error: message });
  };

  bb.on("file", (_field, stream, info) => {
    const name = safeName(info.filename);
    if (name === null) return (stream.resume(), fail(400, "invalid filename")); // drain + reject
    stream.on("limit", () => fail(413, "file exceeds 5 MB limit")); // clean up on limit
    stream.pipe(createWriteStream(join(UPLOAD_DIR, name)));
  });
  bb.on("filesLimit", () => fail(413, "too many files"));
  bb.on("error", () => fail(400, "malformed multipart body"));
  bb.on("close", () => aborted || res.json({ ok: true }));

  req.pipe(bb);
});
```

**Limits/security:** always set `limits` (a missing `fileSize` cap is an
unbounded-write DoS), sanitize the filename to a basename with no NUL byte, and
respond `413`/`400` on a limit or malformed body.

### (b) WebSockets / realtime

zonix-http has no WebSocket/upgrade handling. Attach **socket.io** (or lower-level
`ws`) to the underlying `http.Server`, which a zonix app already owns and exposes
as `app.server`:

```js
import zonix from "zonix-http";
import { Server } from "socket.io";

const app = zonix();
const io = new Server(app.server); // socket.io adds its own upgrade/request listeners
io.on("connection", (socket) => {
  socket.on("chat", (msg) => socket.broadcast.emit("chat", msg));
});
app.listen(3000); // starts the very server socket.io is bound to
```

For video/voice, the server only **relays** WebRTC signaling (the SDP offer/answer
and ICE candidates) between peers — the media itself flows peer-to-peer over
STUN/TURN (run your own [coturn](https://github.com/coturn/coturn)), never through
this server:

```js
io.on("connection", (socket) => {
  socket.on("join", (room) => {
    socket.join(room);
    socket.to(room).emit("peer-joined", socket.id);
  });
  socket.on("offer", ({ room, sdp }) => socket.to(room).emit("offer", { from: socket.id, sdp }));
  socket.on("answer", ({ room, sdp }) => socket.to(room).emit("answer", { from: socket.id, sdp }));
  socket.on("ice-candidate", ({ room, candidate }) =>
    socket.to(room).emit("ice-candidate", { from: socket.id, candidate }),
  );
});
```

**Limits/security:** authenticate the socket handshake, scope broadcasts to rooms
(never global), and remember signaling is untrusted relay — validate room
membership before forwarding.

### (c) HTTPS / TLS

zonix-http serves HTTP and does not reimplement TLS — Node and OpenSSL own it.

**Preferred — terminate at a reverse proxy** (nginx, Caddy, ALB) and run zonix over
plain HTTP behind it. The proxy forwards `X-Forwarded-Proto: https`; set `trustProxy`
so `req.protocol`/`req.secure` (and `secure` cookies) reflect the real scheme. All of
the app's settings apply normally:

```js
import zonix from "zonix-http";

const app = zonix({ trustProxy: 1 });
app.get("/whoami", (req, res) => res.json({ protocol: req.protocol, secure: req.secure }));
app.listen(8080); // the proxy listens on 443 and forwards here
```

**Direct in-process TLS** — hand Node's HTTPS server the app's request listener plus
the two request/response subclasses zonix installs:

```js
import zonix, { ZonixRequest, ZonixResponse } from "zonix-http";
import https from "node:https";
import { readFileSync } from "node:fs";

const app = zonix();
app.get("/whoami", (req, res) => res.json({ secure: req.secure }));

const listener = app.server.listeners("request")[0];
https
  .createServer(
    {
      key: readFileSync("key.pem"),
      cert: readFileSync("cert.pem"),
      IncomingMessage: ZonixRequest,
      ServerResponse: ZonixResponse,
    },
    listener,
  )
  .listen(443);
```

**Caveat:** settings compiled onto the app's own `http.Server` — `cookieSecret`,
`trustProxy`, `queryParser`, `etag` — do **not** transfer to this foreign server, so
anything relying on them (signed cookies, forwarded-header trust) needs the
reverse-proxy path above. TLS itself is not reimplemented (Node/OpenSSL).

### (d) Compressed request bodies

zonix-http never silently inflates a `Content-Encoding: gzip` request body — that is
deliberate, because automatic decompression is a decompression-bomb surface. Opt in
with a small middleware whose byte cap on the **decompressed** stream is the bomb
protection: a 1 KB payload that expands to gigabytes is destroyed the moment it
crosses the cap.

```js
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";

const DECODERS = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };

function inflateRequest({ limit = 10 * 1024 * 1024 } = {}) {
  return (req, res, next) => {
    const encoding = (req.headers["content-encoding"] ?? "identity").toLowerCase();
    if (encoding === "identity") return next();
    const make = DECODERS[encoding];
    if (make === undefined) return res.status(415).json({ error: "unsupported encoding" });

    const decoder = make();
    const chunks = [];
    let total = 0;
    let done = false;
    const end = (fn) => done || ((done = true), fn());

    decoder.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        req.unpipe(decoder);
        decoder.destroy(); // stop inflating — the bomb never fully expands
        return end(() => res.status(413).json({ error: "decompressed body too large" }));
      }
      chunks.push(chunk);
    });
    decoder.on("end", () => end(() => ((req.rawBody = Buffer.concat(chunks)), next())));
    decoder.on("error", () => end(() => res.status(400).json({ error: "malformed body" })));

    req.pipe(decoder);
  };
}

app.post("/ingest", inflateRequest({ limit: 10 * 1024 * 1024 }), (req, res) => {
  res.json({ bytes: req.rawBody.length });
});
```

**Limits/security:** the cap is mandatory — without it a gzip bomb is an OOM. Keep it
as small as your real payloads require, and prefer letting a proxy do decompression
if one already fronts the app.

## Performance

These are **measurements, not marketing** — the full harness, raw per-round
values, spreads, and methodology live in [`bench/`](./bench/results.md), and
every number below was produced by same-session, interleaved, rotating-order
runs inside a CPU-pinned container after byte-checking that all frameworks
returned identical responses. Absolute numbers are specific to that machine;
**the ratios are the claim**. Reproduce with:

```sh
node bench/container.mjs --cpus=8 -- node bench/matrix.mjs --frameworks=zonix,express,fastify,cpeak
```

Requests/second, `--cpus=8` container, Node 22 (zonix absolute | ratio vs
express 4.22.2 / fastify 5.12.1 / cpeak 2.9.2):

| Scenario                  |     zonix rps | vs express | vs fastify |   vs cpeak |
| ------------------------- | ------------: | ---------: | ---------: | ---------: |
| hello                     |       161,984 |      5.78× |      0.94× |      1.19× |
| 6 param routes            |       147,712 |      5.65× |      0.91× |      1.20× |
| 200 param routes          |       147,187 |      6.58× |     1.37×¹ |      1.19× |
| 10-middleware chain       |       151,475 |      5.62× |      0.91× |      1.53× |
| 404                       |       150,323 |      6.03× |      0.98× |      1.11× |
| POST JSON echo            |        82,912 |      5.66× |      1.78× |      1.08× |
| file 1 KB (default)       | 11,337–12,458 | 1.60–1.76× | 1.28–1.43× | 1.68–1.84× |
| file 1 KB (opt-in cache)² |        28,603 |      4.03× |      3.24× |      4.25× |

¹ Fastify's measured throughput dropped with routing-table size in our runs
(172k rps at 6 routes → 107k at 200); zonix stayed flat (161k → 147k). Treat
the 1.37× as specific to this workload and harness configuration — rerun it
on yours. zonix was never faster than Fastify on the small-table scenarios
(0.91–0.98×) and we print that just as plainly.
² Warm steady-state with `{ cache: { maxBytes } }` enabled — opt-in, never
the default number. Ranges on the default file row span two independent
measurement sessions.

### Footprint

|                            |        zonix |  express | fastify |
| -------------------------- | -----------: | -------: | ------: |
| Install size               | **116.3 KB** |  2.21 MB | 7.38 MB |
| Files installed            |        **5** |      618 |   2,033 |
| Packages installed         |        **1** |       68 |      56 |
| Cold import (median of 10) |  **16.2 ms** |  77.5 ms | 68.8 ms |
| RSS after 10k requests     |      47.1 MB | 100.8 MB | 56.3 MB |

Fastify's steady-state memory is only 1.20× zonix's — the order-of-magnitude
differences are install size and file count, not RSS. On a machine with
antivirus scanning, first-ever import measured 21.6 ms for zonix vs 1,240 ms
(express) and 1,487 ms (fastify): file count becomes wall-clock.

### Performance recipes

Everything below is opt-in and copy-paste ready. zonix is pay-for-what-you-
use: features you don't touch cost zero per request, so the recipes are
mostly about switching on the right cache for your workload.

**1. Cache small static assets in memory** — the single biggest win for
asset-heavy apps (2.5× zonix's own default, ~4× Express, measured above):

```ts
app.use(zonix.static("./public", { cache: { maxBytes: 8 * 1024 * 1024 } }));
```

LRU by bytes; every hit revalidates against the file's mtime with one
`stat()`, so an edited file is never served stale. 304s, ranges and
compression all work on top of the cached bytes.

**2. Schema serializer for hot JSON endpoints** — skip `JSON.stringify`'s
shape discovery on routes you hit thousands of times a second:

```ts
import zonix, { createSerializer } from "zonix-http";

const serializeUser = createSerializer({
  type: "object",
  properties: {
    id: { type: "number" },
    name: { type: "string" },
    active: { type: "boolean" },
  },
});

app.get("/users/:id", (req, res) => {
  res.type("json").send(serializeUser({ id: 42, name: "ada", active: true }));
});
```

Parity is the contract: for any value it returns exactly what
`JSON.stringify` would (fuzz-tested), so a mismatched value degrades
gracefully instead of corrupting output. No codegen, no `eval`.

**3. Keep the simple query parser unless you need nesting.** The default
parses `?a=1&b=2` with a flat, allocation-light scanner. Only opt into
`app.set("query parser", "extended")` on apps that actually read
`?filter[status]=active` shapes — nested parsing costs more per request.

**4. Leave ETags off unless clients revalidate.** zonix ships ETags off by
default (a deliberate deviation from Express): hashing every response body
costs CPU per request, and most APIs sit behind a CDN or proxy that already
does this. If your clients _do_ send `If-None-Match`, enable it and 304s
save you the bandwidth:

```ts
import { etag } from "zonix-http";
app.use(etag()); // weak ETags + conditional-request handling
```

**5. Set body limits to what you actually accept.** The limit is enforced
byte-by-byte as chunks arrive — a tight limit means an abusive upload is cut
off after `limit` bytes, not after your default:

```ts
app.use(zonix.json({ limit: "16kb" })); // typical API payloads are small
```

**6. Register everything before traffic, not during.** Route chains are
precomposed and cached; calling `app.use()` after requests have started
invalidates that cache. Structure apps as: register all middleware and
routes, then `app.listen()`.

**7. Don't enable what you don't use.** `trustProxy`, `cookieSecret`,
extended queries and compression each cost only when active — the fastest
configuration is the default one plus exactly what your app needs.

### Measured and rejected

Optimizations tried under the same harness and **removed** because the
numbers said no — recorded so they don't come back:

- **Generated serializer code** (`new Function` codegen): the closure-based
  serializer matched it, without the eval surface.
- **`.pipe()` instead of `pipeline()`** for file streaming: no measurable
  win; worse error semantics.
- **256 KB `highWaterMark`** on file streams: no measurable win.
- **"Turbo" request path** (bypassing the composed chain): 1.362× at an
  adjudication bar of 1.40× — killed, with the falsification record kept in
  the repo.

## Express compatibility

The middleware signature, routing semantics, and response helpers match
Express — the test suite diffs zonix's wire output against real Express
rather than trusting hand-written expectations. Known, deliberate
differences:

| #   | Behavior                       | zonix                                                                                                                                                         | Express 4                                                     |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `req.host`                     | Express **5** semantics: includes the port, trust-proxy aware, IPv6-bracket safe (`req.hostname` strips the port)                                             | Strips the port                                               |
| 2   | `req.is(type)`                 | Returns the **matched type**                                                                                                                                  | Same shape, minor edge differences                            |
| 3   | `use()` ordering               | All global middleware runs **before any route**, in registration order                                                                                        | Positional: middleware registered after a route runs after it |
| 4   | Query parser default           | `simple` (flat pairs, Express 5's default); opt in with `app.set("query parser", "extended")`                                                                 | `extended` (nested brackets)                                  |
| 5   | ETag default                   | **Off** (opt-in) — cache validators cost CPU per response and most APIs sit behind a proxy that does this                                                     | Weak ETags on                                                 |
| 6   | Unsatisfiable `Range: bytes=…` | **416**, per RFC 9110                                                                                                                                         | 200 with the full body                                        |
| 7   | Body parsing                   | `req.body = {}` when a parser skips (no body / other content-type); charsets beyond UTF-8/Latin-1/ASCII/UTF-16LE → **415**; no `allowPrototypes` escape hatch | `undefined` on skip; decodes exotic charsets via iconv-lite   |
| 8   | `res.send(number)`             | Throws with a pointer to `res.sendStatus` — `res.send(404)` reads like a status but Express sends the body `"404"`                                            | Sends the number as a body (deprecated)                       |

(`If-None-Match: *` handling follows Express's inherited quirk, chosen
deliberately so caching proxies see identical behavior.)

## Contributing

```sh
git clone https://github.com/Swapnil155/zonix-http.git
cd zonix-http
npm install
npm test          # node:test suite via tsx
npm run typecheck # tsc --noEmit, strict
npm run build     # tsup → dist/
```

Every feature lands with tests in the same commit; inlined package equivalents
carry a differential test against the original they replace. Run `npm test`
and `npm run typecheck` before opening a pull request.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security reports. See
[`SECURITY.md`](./SECURITY.md) for the private disclosure process, supported
versions, and expected response timeline.

## License

[MIT](./LICENSE) © Swapnil Bendal
