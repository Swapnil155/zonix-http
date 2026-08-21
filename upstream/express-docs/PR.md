# DRAFT — Express docs PR: `req.is()` wildcard examples contradict the actual behaviour

> **Status: ready to file, pending Swapnil's review. Nothing has been filed.**
> Target repo: `expressjs/expressjs.com`, branch `main`.
> Files: `src/content/api/5x/api/request/index.mdx` and
> `src/content/api/4x/api/request/index.mdx` (same example block in both).

## The defect

The prose above the example is **correct**:

> Returns the **matching content type** if the incoming request's
> "Content-Type" HTTP header field matches the MIME type specified by the
> `type` parameter.

The examples then contradict it for wildcard patterns:

```js
req.is("text/*"); // => 'text/*'          <- docs claim the PATTERN comes back
req.is("application/*"); // => 'application/*'
```

`type-is` — the library `req.is()` delegates to, linked at the bottom of the
same doc section — returns the **matched content type**, not the pattern:

```js
// With Content-Type: text/html; charset=utf-8
req.is("text/*"); // => 'text/html'

// When Content-Type is application/json
req.is("application/*"); // => 'application/json'
```

## Verification (all run, not assumed)

| Check                                                  | Result                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `type-is@1.6.18` (Express 4's dependency), direct call | `typeis(req, ['application/*'])` → `"application/json"`                                       |
| `type-is@2.1.0` (Express 5's dependency), direct call  | `"application/json"` — identical behaviour                                                    |
| Real Express 4.22.2, over the wire                     | a handler returning `req.is("application/*")` for a JSON POST sends `"application/json"`      |
| `+json` suffix patterns behave the same way            | `req.is('+json')` on `application/vnd.api+json` → `"application/vnd.api+json"`, not `"+json"` |

The wire test lives in this repo as
`test/compat/express-differential.test.ts` (the same handler run on Express
and compared byte-for-byte); the library checks are one-liners against the
pinned packages.

How we found it: while building an Express-compatible surface, our first
implementation returned the pattern **because the docs said so**; a
differential test against real Express failed, and the pinned `type-is`
differential (`test/compat/type-is-differential.test.ts`) confirmed the
library has never returned the pattern for wildcard or suffix matches.

## The proposed change (both files, identical block)

```diff
 // With Content-Type: text/html; charset=utf-8
 req.is('html'); // => 'html'
 req.is('text/html'); // => 'text/html'
-req.is('text/*'); // => 'text/*'
+req.is('text/*'); // => 'text/html'

 // When Content-Type is application/json
 req.is('json'); // => 'json'
 req.is('application/json'); // => 'application/json'
-req.is('application/*'); // => 'application/*'
+req.is('application/*'); // => 'application/json'
```

No prose changes needed — the prose is already right; only the examples
disagree with it.

## Suggested PR title and body

**Title:** `docs: req.is() wildcard examples show the pattern, but the method returns the matched type`

**Body:**

> The `req.is()` section says it "returns the matching content type", and the
> non-wildcard examples show exactly that. The two wildcard examples, however,
> claim the _pattern_ comes back (`req.is('text/*') // => 'text/*'`), which is
> not what happens: `type-is` returns the matched type for wildcard and
> `+suffix` patterns.
>
> Verified against `type-is@1.6.18` (4.x line) and `type-is@2.1.0` (5.x line),
> and over the wire against express@4.22.2 — all three return
> `'application/json'` for `req.is('application/*')` on a JSON request.
>
> We hit this while building against the docs: code written to the documented
> return value fails against the real one. This PR only corrects the two
> comments, in both the 4.x and 5.x pages; the surrounding prose is already
> accurate.

## Filing notes

- One commit, two files, four changed lines (two per file).
- The 4x file needs the same before/after inspection at filing time; the 5x
  block is quoted verbatim above from `main` as of 2026-08-21.
- No behaviour change is proposed anywhere — this is docs-only, aligning the
  examples with `type-is`'s documented and tested behaviour.
