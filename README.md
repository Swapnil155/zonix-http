# zonix

A zero-dependency, Express-compatible HTTP framework for Node.js.

`npm install` brings in **one package, 5 files, ~116 KB** — no dependency
tree, no transitive CVEs, nothing to audit but this repository. The API is
Express's: middleware `(req, res, next)`, routers, `res.send/json/sendFile`,
signed cookies, static files with caching/ETags/ranges/compression. A real
Express app has been ported by changing **only the import line** — the wire
output was byte-identical across a 41-request test corpus.

- **Zero runtime dependencies** — `node:` builtins only.
- **TypeScript strict, ESM, Node ≥ 20** — tested on Node 20, 22 and 24.
- **894 tests**, ≥ 90% enforced coverage on `lib/`, plus differential tests
  against the original packages each inlined module replaces (qs, negotiator,
  fresh, range-parser, etag, compression, cookie-signature, type-is…).
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

Everything else works the way you expect from Express: `app.use(path, fn)`,
`zonix.Router()` with nesting and `baseUrl`/`originalUrl`, `app.all()`, the
settings API (`app.set/enable/disable`), `zonix.static(root)`,
`zonix.urlencoded({ extended: true })`, `zonix.raw()`, `zonix.text()`,
`res.cookie` / signed cookies, `res.sendFile`, `res.format`, `req.accepts`,
trust proxy, and central error handling — `next(err)`, thrown errors and
rejected async handlers all reach your error middleware.

## Features

- **Router** — radix tree per method; static > param > wildcard precedence
  with backtracking; duplicate route registration throws; malformed
  percent-encoding answered with 400; `HEAD` falls back to `GET` unless an
  explicit `HEAD` route exists.
- **Middleware** — global chain then route chain, precomposed and cached per
  route; 4-arity `(err, req, res, next)` error middleware; mounting with URL
  rewrite.
- **Body parsing** — `json`, `urlencoded` (simple and extended), `raw`,
  `text`; byte-exact size limits; an oversized body gets a real `413` with
  `Connection: close`, never a socket reset.
- **Static files** — `zonix.static(root)` with ETags, `If-None-Match`/304,
  byte ranges/206, negotiated compression (gzip/deflate/brotli), dotfile
  protection, and an opt-in in-memory cache:
  `zonix.static(root, { cache: { maxBytes: 4 * 1024 * 1024 } })` (LRU,
  revalidated against mtime on every hit — never serves stale bytes).
- **Content negotiation** — `req.accepts` / `acceptsCharsets` /
  `acceptsEncodings` / `acceptsLanguages`, `res.format`, all linear-time
  parsers.
- **Schema serializer** — optional `createSerializer(schema)` for hot JSON
  endpoints; plain `res.json` is already fast.
- **Security posture** — see [SECURITY.md](./SECURITY.md): null-prototype
  `req.query`/`req.cookies`, prototype-pollution guards fuzz-tested against
  the qs oracle, path-traversal defense in `static`, CRLF rejection in every
  header-writing API, HMAC-SHA256 signed cookies with constant-time compare.
  No `eval`, no codegen, no regex with nested quantifiers anywhere.

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

## Security

See [SECURITY.md](./SECURITY.md) for the disclosure process, threat model,
and the guard-by-guard list with the test file that enforces each one.

## License

[MIT](./LICENSE) © Swapnil Bendal
