# Turbo — a second transport for zonix

> **Status: design, not a work order.** CLAUDE.md M4 is explicit that nothing in
> the Turbo track starts before v1.0 is on npm, except the T-0 spike — which is
> now done and passed. This document is what T-0 unlocked: the design that must
> exist _before any further code_. It is written to be argued with.

---

## 0. The number this is all built on, stated honestly

T-0 was re-run on the reference rig (see `bench/results.md`, "T-0 Turbo spike —
official adjudication"). Both configurations cleared the 1.30× kill bar:

| Config                       | raw `node:http` |     turbo |      ratio |
| ---------------------------- | --------------: | --------: | ---------: |
| pipelining = 16              |         150,848 | 1,606,115 | **10.78×** |
| pipelining = 1               |          84,167 |   144,325 |  **1.71×** |
| server ceilings              |          90,494 |   152,188 |  **1.68×** |
| single client, no pipelining |          37,896 |    43,896 |  **1.16×** |

**The design must be judged against ~1.65×, not against 10.78×.** Three reasons,
and each one matters more than the last:

1. **The corked figure describes deeply pipelined clients**, which almost no
   real HTTP/1.1 client generates. Browsers abandoned pipelining.
2. **It was measured with colocation amplification** — on a busy box, cycles the
   server doesn't burn become client capacity. Real deployments don't run the
   load generator on the server.
3. **The spike never had to preserve response order.** It answered every request
   in the same synchronous tick it parsed them, so "N responses in one write"
   was free. Production Turbo runs user handlers that may be async, and HTTP/1.1
   requires responses in request order (§5.3). Once responses can complete out
   of order, the corking win largely evaporates — you cannot concatenate
   responses you are still waiting for.

So: **the transferable, defensible headroom is ~1.65× on throughput, under
concurrency, with no pipelining.** Everything below is designed to spend as
little of that as possible. And it does not make an idle server answer faster —
at one sequential connection the measured ratio was 1.16×. Turbo is a
throughput feature; it will be documented as one.

### The gate that actually decides Turbo's fate

M4 sets it: **if the compat shim erodes the margin below 1.2×, Turbo dies at the
design stage rather than shipping.** In absolute terms on this rig:

```
raw node:http     ~91,000 rps   (the baseline every framework pays)
turbo bare       ~152,000 rps   (measured, T-0)
turbo + shim     ≥109,000 rps   REQUIRED  (1.2 x 91,000)
```

The shim may consume at most **69%** of the saving. That is the whole
engineering problem, and §7 is where it is confronted.

---

## 1. Architecture: transports are pluggable, `node:http` stays the product

```
                    ┌───────────────────────────────────┐
                    │  Zonix app: router, middleware    │
                    │  chain, central error dispatch    │
                    │  (unchanged, shared, one copy)    │
                    └───────────────┬───────────────────┘
                                    │  dispatch(req, res)
                    ┌───────────────┴───────────────────┐
                    │                                   │
        ┌───────────▼───────────┐         ┌─────────────▼─────────────┐
        │ transport: node-http  │         │ transport: turbo          │
        │ http.createServer({   │         │ net.createServer()        │
        │   IncomingMessage,    │         │ + parser state machine    │
        │   ServerResponse })   │         │ + req/res shims           │
        │ DEFAULT, FOREVER      │         │ EXPERIMENTAL, OPT-IN      │
        └───────────────────────┘         └───────────────────────────┘
```

```ts
zonix(); // node:http. The product. Never changes.
zonix({ transport: "turbo" }); // opt-in, experimental-flagged
```

**The transport boundary is one function.** A transport's only job is to produce
a `(req, res)` pair and hand it to the app's dispatcher, then clean up. It owns
no routing, no middleware, no error policy — those stay in exactly one place, or
we have built two frameworks that drift apart.

```ts
export interface Transport {
  listen(options: ListenOptions, onListening: () => void): void;
  close(callback: (err?: Error) => void): void;
  address(): AddressInfo | null;
  /** Set by Zonix before listen(). */
  onRequest: (req: ZonixRequestLike, res: ZonixResponseLike) => void;
}
```

### Proposed file layout (extends the authoritative tree)

Structure rule 4 says every new file has exactly one legal home. Turbo's home is
a new `lib/transport/` directory, and `node-http.ts` is the _existing_ wiring
extracted into it unchanged:

```
lib/transport/
├── index.ts              # Transport interface, selection by options.transport   ~60
├── node-http.ts          # today's createServer path, moved not rewritten       ~90
└── turbo/
    ├── server.ts         # net server, connection lifecycle, timing wheel      ~260
    ├── parser.ts         # the state machine — the security surface            ~420
    ├── connection.ts     # per-socket state: pipeline queue, ordering, drain   ~240
    ├── request.ts        # req shim                                            ~180
    ├── response.ts       # res shim (the Writable question, §7)                ~300
    └── limits.ts         # every cap in one file, nothing hard-coded elsewhere  ~40

test/transport/
├── equivalence.test.ts   # THE test: same app, both transports, same bytes
├── parser.test.ts
├── pipelining.test.ts
├── timeouts.test.ts
└── backpressure.test.ts
test/security/
└── smuggling.test.ts     # CL/TE suite — non-negotiable, §4
test/fuzz/
└── parser.fuzz.ts        # seeded, zero-dep, §8
```

`limits.ts` existing as its own file is deliberate: a magic number buried in a
parser is a magic number nobody audits.

---

## 2. The parser state machine

One parser instance per connection, fed byte ranges from `data` events. It never
allocates a string for a header it is not asked for (lazy header access is
already how zonix works — decision 1 — and it is one of the savings we keep).

```
        ┌──────────────┐
        │ REQUEST_LINE │──── malformed ────────────────┐
        └──────┬───────┘                               │
               │ CRLF found                            │
        ┌──────▼───────┐                               │
   ┌───▶│   HEADERS    │──── malformed / limits ───────┤
   │    └──────┬───────┘                               │
   │           │ empty line                            │
   │    ┌──────▼───────┐                               │
   │    │  FRAMING     │  decide body framing (§4)     │
   │    └──┬────────┬──┘──── CL/TE conflict ───────────┤
   │       │        │                                  │
   │  ┌────▼───┐ ┌──▼──────────┐                       │
   │  │ BODY_  │ │ BODY_       │─── bad chunk ─────────┤
   │  │ LENGTH │ │ CHUNKED     │                       │
   │  └────┬───┘ └──┬──────────┘                       │
   │       │        │                                  │
   │    ┌──▼────────▼──┐                        ┌──────▼──────┐
   └────│   COMPLETE   │                        │    FATAL    │
 next   └──────────────┘                        │ 4xx + CLOSE │
 request   (keep-alive)                         └─────────────┘
```

**`FATAL` is a one-way door.** There is no error recovery, no resynchronisation,
no "skip to the next CRLF and try again". Once a connection has produced a byte
we do not understand, its framing is unknowable, and a server that guesses about
framing is a smuggling vulnerability. The socket is destroyed after a best-effort
error response.

### Parsing rules that are not negotiable

- **Header names must be RFC 7230 tokens.** Any other byte → `FATAL`.
- **No whitespace between header name and colon.** `Content-Length : 5` → `FATAL`.
  (This is a documented smuggling vector; RFC 9112 §5.1 requires rejection.)
- **`obs-fold` (a continuation line starting with SP/HTAB) → `FATAL`.** RFC 9112
  permits rejecting it, and it is a smuggling classic. We reject.
- **A bare CR or bare LF as a line terminator → `FATAL`.** Only CRLF ends a line.
  Tolerating bare LF is precisely how front-end/back-end desync happens.
- **NUL anywhere in the request line or headers → `FATAL`.**
- Request target must be origin-form (`/path?query`) or, for `OPTIONS`, `*`.
  Absolute-form is accepted and the authority ignored (proxies send it);
  authority-form (`CONNECT`) → `405`.

### Limits (all in `limits.ts`, all tested at their exact boundary)

| Limit                   |  Default | Violation     |
| ----------------------- | -------: | ------------- |
| request line            |    8 KiB | `414` + close |
| single header line      |    8 KiB | `431` + close |
| total header block      |   16 KiB | `431` + close |
| header count            |      100 | `431` + close |
| chunk-size line         | 32 bytes | `400` + close |
| chunk extensions        |    256 B | `400` + close |
| trailer block           |    4 KiB | `400` + close |
| body (default)          |    1 MiB | `413` + close |
| pipelined in flight     |        8 | pause reading |
| buffered response bytes |    1 MiB | pause reading |

The body limit is a transport-level backstop, not a replacement for
`parseJSON({ limit })` — it exists so a body can never exhaust memory before
middleware gets a say.

---

## 3. Bodies

**`Content-Length`.** Read exactly N bytes. The value must match `/^[0-9]+$/`
after trimming OWS — no `+`, no `-`, no hex, no leading `0x`, no embedded space.
A value that overflows `Number.MAX_SAFE_INTEGER` → `FATAL`.

**`Transfer-Encoding: chunked`.** Chunk size is hex digits only, followed by
optional `;ext` and CRLF. Then exactly that many bytes, then CRLF (which must be
present — a chunk not followed by CRLF is `FATAL`). A `0` chunk ends the body,
followed by an optional trailer block, then CRLF.

**Trailers are parsed, bounded, and discarded.** They are not exposed on `req`.
Merging trailers into `req.headers` after handlers have already read headers is
another desync vector, and no zonix API needs them.

**Bodies are streamed, never buffered by the transport.** `req` is a `Readable`
(§7) and body bytes are pushed into it as they arrive. If nothing reads the body
and the handler responds anyway, remaining body bytes are drained up to the body
limit so the connection stays framed; past that limit, close.

---

## 4. Request smuggling — the non-negotiable suite

M4 states the rule: **CL/TE conflicts hard-close the connection.** Concretely,
every one of the following is `400` + immediate `socket.destroy()`, and every one
gets a test in `test/security/smuggling.test.ts` sending raw bytes:

| Input                                                       | Why                                      |
| ----------------------------------------------------------- | ---------------------------------------- |
| Both `Content-Length` and `Transfer-Encoding` present       | The canonical CL.TE / TE.CL desync       |
| Two `Content-Length` headers, values differing              | Front/back disagree on body length       |
| Two `Content-Length` headers, values identical              | Rejected anyway — cheaper than nuance    |
| `Content-Length: 5, 5` (comma list)                         | Same, in one header                      |
| `Transfer-Encoding: chunked, chunked`                       | Double-encoding ambiguity                |
| `Transfer-Encoding: identity` / anything not ending chunked | Unframed body                            |
| `Transfer-Encoding: xchunked`, ` chunked`, `chunked\t`      | Obfuscation variants that fool parsers   |
| `Content-Length : 5` (space before colon)                   | Header-name smuggling                    |
| Bare LF used as a line terminator                           | Front-end and back-end split differently |
| `obs-fold` continuation line                                | Classic desync primitive                 |
| Chunk size with `+`, `-`, `0x`, or whitespace               | Chunk-size parsing divergence            |
| A chunk body not followed by CRLF                           | Length ambiguity                         |

**"Hard-close" is defined precisely**: write the 4xx if and only if nothing has
been written for this request yet, then `socket.destroy()` — never `end()`, never
keep-alive, never process any bytes already buffered after the offending
request. Bytes after a `FATAL` are attacker-chosen and must never be interpreted.

A second, subtler rule: **once a response has been written for request N, no
request N+1 that was pipelined behind a `FATAL` may be dispatched.** The
connection dies whole.

This suite is the reason Turbo cannot ship on enthusiasm. `node:http` has had
this surface audited by many people for a decade; a hand-rolled parser has had it
audited by one. Turbo stays experimental-flagged until this suite plus the fuzz
corpus (§8) are green, and even then `node:http` remains the default.

---

## 5. Connection lifecycle, timeouts, slowloris

Three timeouts, each with a distinct job:

| Timeout            | Default | Meaning                                    | On expiry     |
| ------------------ | ------: | ------------------------------------------ | ------------- |
| `headersTimeout`   |    20 s | first byte → end of header block           | `408` + close |
| `requestTimeout`   |    60 s | first byte → end of body                   | `408` + close |
| `keepAliveTimeout` |     5 s | idle between requests on a live connection | close, silent |

**Implementation: one timing wheel, not one timer per socket.** A single
`setInterval` at 1 s granularity sweeps buckets of connections. Per-socket
`setTimeout`/`refresh` on every data event is a measurable per-request cost and
would eat margin we cannot spare. Coarse granularity is fine — these are
multi-second limits — and the wheel costs O(expired), not O(connections).

Slowloris posture follows directly: a connection dribbling headers dies at
`headersTimeout` regardless of activity, because the clock starts at the first
byte and is not refreshed by progress. This mirrors the posture already
documented for the `node:http` transport, and the same raw-socket test in
`test/security/slowloris.test.ts` must pass against both transports.

Also handled at this layer: `Connection: close` is honoured; HTTP/1.0 defaults to
close unless `Connection: keep-alive`; `Expect: 100-continue` gets a `100 Continue`
before the body is read; `Connection: Upgrade` gets a clean `501` (Turbo does not
do WebSockets, and a half-understood upgrade is worse than a refusal).

---

## 6. Pipelining and response ordering

This is the part the spike skipped, and it is where the corking win goes to die.

HTTP/1.1 requires responses in request order. With async handlers, request 2 may
finish before request 1. So each connection holds:

```
requests in  ──▶ [ slot0 ][ slot1 ][ slot2 ] ──▶ handlers (concurrent)
                    │        │        │
responses out ◀── head-of-line queue: emit slot N only when slots 0..N-1 are done
```

- **Cap in-flight pipelined requests at 8.** On the 9th, stop reading from the
  socket until the head drains. This bounds both memory and the damage a single
  connection can do.
- **Cap buffered completed-but-blocked response bytes at 1 MiB per connection.**
  Past that, the connection is destroyed: a client that pipelines 8 requests and
  then refuses to read is attacking us.
- **Corking is opportunistic, not architectural.** When two or more responses
  are ready in the same tick, they are concatenated into one `write`. When they
  are not — the common case with async handlers — nothing is held back waiting
  for a friend. Latency is never traded for a batching statistic.

**Honest consequence:** for a typical async workload the corking multiplier is
~1×, and Turbo's advantage reduces to the per-request lifecycle saving. That is
the 1.65×, and it is still worth having — but the design refuses to pretend
otherwise, and the eventual README must not either.

---

## 7. The compat shim — where Turbo lives or dies

The measured 1.65× comes from three savings. The shim threatens each differently:

| Saving                                             | Threat from compat                                                                         | Verdict      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| No `IncomingMessage`/`ServerResponse` construction | Shims are cheaper objects; we control the shape                                            | **Keepable** |
| No eager full header parse                         | zonix is already lazy (decision 1)                                                         | **Keepable** |
| No stream machinery                                | `sendFile` does `pipeline(createReadStream(path), res)`; user code does `stream.pipe(res)` | **At risk**  |

**The stream question is the design's single biggest open risk.** `res` must
behave enough like a `Writable` for `node:stream/promises.pipeline` to accept it,
and `req` enough like a `Readable` for body parsers. Three options:

- **(a) Extend `stream.Writable`/`Readable`.** Correct, compatible, and hands
  back a large share of the saving — this is much of what `node:http` is paying
  for.
- **(b) Hand-roll the interface** (`write`/`end`/`cork`/`uncork`/`destroy`, the
  `drain`/`error`/`close` events) without extending the base classes. Cheap, but
  `pipeline` performs `isWritable`-style duck-typing and other libraries do
  worse; every third-party middleware that treats `res` as a stream is a
  compatibility landmine.
- **(c) Hybrid — the proposal.** The shim is hand-rolled for the paths zonix
  controls (`json`, `send`, `end`, buffered `sendFile` ≤ 32 KB — already the
  common case since F1), and **lazily upgrades to a real `Writable` on first
  touch of a streaming API**. Pay-for-what-you-use (performance rule 1) applied
  to the transport itself: a hello-world response never constructs a stream; a
  1 MB `sendFile` does, and gladly.

Option (c) is the design's bet, and it is a bet, not a conclusion.

### T-1: the gate before any hardening work

Before the parser is hardened, before the smuggling suite is written, **build the
thinnest possible end-to-end path and measure it**:

1. Real zonix app object (router, middleware chain, error dispatch — unchanged).
2. Turbo transport with a _correct but unhardened_ parser.
3. Shim per option (c).
4. Same paired, interleaved bench as T-0, same rig, quiet machine, ≥5 pairs.

```
KILL BAR:  turbo + shim ≥ 1.20 x raw node:http   (≥ ~109,000 rps on this rig)
```

Below the bar → **Turbo dies here**, having cost one more session instead of a
quarter, and this file records the number. Above it → the hardening work in §§3–6
and §8 is justified, and only then is it worth doing.

This ordering is deliberate. The expensive, security-critical work is the
hardening; the cheap, decisive question is whether the margin survives contact
with the compat surface. Answer the cheap question first.

---

## 8. Fuzz corpus

Zero-dep, seeded, deterministic, in the existing `test/fuzz/rng.ts` style — the
seed prints on failure for replay. The property under test is not "parses
correctly"; it is:

> For **any** byte sequence, the parser either produces a well-formed request,
> or closes the connection with a 4xx. It never throws past the connection
> handler, never hangs, never buffers unboundedly, and never spends more than
> O(bytes) time.

Corpus generators:

- **Truncation sweep** — every valid request in the corpus, cut at every byte
  offset, delivered in one packet and dribbled byte-by-byte. (T-0's gauntlet
  already proved dribbling matters; this generalises it.)
- **Split sweep** — valid requests split across packet boundaries at every
  offset, including mid-CRLF and mid-chunk-size.
- **Random bytes** — pure noise, and noise prefixed with a valid request line.
- **Header floods** — 10k headers, one 10 MB header, 10k-byte names.
- **Chunk abuse** — negative, huge, hex-adjacent, missing CRLF, extension floods.
- **Smuggling mutations** — the §4 table, generated combinatorially rather than
  listed by hand, since the vulnerability lives in the combinations.
- **Injection** — CR, LF, NUL at every position in target, names and values.

---

## 9. Equivalence: the test that keeps two transports one framework

Performance rule 3 says fast paths are guarded, not trusted, and requires a
byte-identical wire-output test. A second transport is the largest fast path this
project will ever have, so it gets the same treatment, scaled up:

**`test/transport/equivalence.test.ts` runs the identical zonix app on both
transports and asserts byte-identical responses** (modulo `Date`) across a
corpus: every method, params, wildcards, 404, thrown handlers, rejected promises,
`sendFile` above and below the 32 KB buffered threshold, `res.send` inference,
cookies, redirects, client disconnects mid-stream, HEAD, and 204/304 bodylessness.

This is the same instrument as `test/compat/express-differential.test.ts`, aimed
inward: the `node:http` transport is the oracle, Turbo is the implementation
under test. Any divergence is a Turbo bug by definition — which is exactly the
property that keeps "zonix" one framework with two engines rather than two
frameworks with one name.

---

## 10. Scope: what Turbo will never do

Recorded now so it cannot drift later.

- **No TLS.** `https` stays on `node:http`'s transport. TLS termination belongs
  in front of this process anyway.
- **No HTTP/2, no WebSockets, no `Upgrade`.** `501`, cleanly.
- **No trailers exposed to handlers.**
- **Never the default.** `zonix()` is `node:http` compatibility, permanently.
  Turbo is `zonix({ transport: "turbo" })`, experimental-flagged in the README
  and in a startup warning until the security suites have shipped green for a
  full release cycle.
- **Not a selling point until it is safe.** The README claim, when it comes, is
  "an optional experimental transport worth ~1.6× on throughput", with the
  1.16×-at-one-connection caveat beside it. Not "10× faster". This project has
  spent four sessions learning how benchmarks lie; it will not start telling one
  on the last page.

---

## 11. Open questions for Swapnil

1. **Is the 1.2× bar still right given §0?** The honest headroom is ~1.65×, and
   the shim has to fit inside 69% of it. That is tight. An alternative reading:
   raise the bar to 1.3× so a marginal pass doesn't buy a permanent
   security-critical parsing surface for a barely-visible win.
2. **Does the body limit belong at the transport at all**, or should Turbo simply
   refuse to be the place where that policy lives and stream everything to
   middleware? (Proposal above says transport-level backstop; it is arguable.)
3. **Option (c)'s lazy `Writable` upgrade** is unproven. If T-1 shows the
   hand-rolled shim breaks `pipeline`, the fallback is (a) — and (a) probably
   fails the bar. Worth knowing before committing.
4. **v3 sequencing:** M4 says nothing starts before v1.0 is on npm. T-1 is one
   session and it is the decisive one. Run it early as a spike anyway, or hold
   the line?
