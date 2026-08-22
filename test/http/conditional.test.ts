/**
 * `preconditionFailed` and `rangeFresh` verified against `send@0.19.2`'s
 * `isPreconditionFailure` / `isRangeFresh` — the code behind Express's
 * `res.sendFile` — driven with the same fake req/res (rule 8).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { preconditionFailed, rangeFresh } from "../../lib/http/fresh.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const send = createRequire(import.meta.url)("send") as any;

function oracle(
  reqHeaders: Record<string, string | undefined>,
  resHeaders: Record<string, string | undefined>,
) {
  const stream = send({ headers: reqHeaders }, "/x", {});
  stream.res = {
    getHeader: (name: string) => resHeaders[name.toLowerCase()],
  };
  return stream;
}

const TAGS = [undefined, '"abc"', 'W/"abc"', '"zzz"'];
const MATCH = [undefined, "*", '"abc"', 'W/"abc"', '"zzz"', '"zzz", "abc"', '"abc",', ""];
const DATES = [
  undefined,
  "Sat, 01 Jan 2000 00:00:00 GMT",
  "Sat, 01 Jan 2000 00:00:01 GMT",
  "Fri, 31 Dec 1999 23:59:59 GMT",
  "garbage",
  "",
];

describe("conditional: differential against send@0.19.2", () => {
  test("preconditionFailed agrees across If-Match x ETag x If-Unmodified-Since x Last-Modified", () => {
    for (const ifMatch of MATCH) {
      for (const etag of TAGS) {
        for (const ius of DATES) {
          for (const lm of DATES) {
            const req = { "if-match": ifMatch, "if-unmodified-since": ius };
            const res = { etag, "last-modified": lm };
            assert.equal(
              preconditionFailed(req, res),
              oracle(req, res).isPreconditionFailure(),
              JSON.stringify({ req, res }),
            );
          }
        }
      }
    }
  });

  test("rangeFresh agrees across If-Range x ETag x Last-Modified", () => {
    const IF_RANGE = [undefined, "", '"abc"', 'W/"abc"', '"zzz"', ...DATES.slice(1)];
    for (const ifRange of IF_RANGE) {
      for (const etag of TAGS) {
        for (const lm of DATES) {
          const req = { "if-range": ifRange };
          const res = { etag, "last-modified": lm };
          assert.equal(
            rangeFresh(ifRange, etag, lm),
            oracle(req, res).isRangeFresh(),
            JSON.stringify({ req, res }),
          );
        }
      }
    }
  });
});
