import { parse as parseSimple } from "node:querystring";
import { typeIs } from "../compat/request.js";
import { ErrorCode, frameworkError } from "../errors/index.js";
import { parseExtendedQuery, type ParsedQuery } from "../query/extended.js";
import { ZonixRequest } from "../request.js";
import type { Middleware } from "../types.js";
import { contentCharset, readBody, stripBom, toBytes } from "./read.js";

export interface UrlencodedOptions {
  /**
   * `true` parses nested keys (`a[b][]=1`) with the extended parser
   * (`qs` semantics, decision-10 posture); `false` (the default) is the
   * flat `querystring` parser where a repeated key becomes an array.
   */
  extended?: boolean;
  /** Maximum body size, as `parseJSON` accepts it. Defaults to `"100kb"` (body-parser's). */
  limit?: string | number;
  /** Maximum number of `&`-separated parameters; more is a 413. Defaults to 1000. */
  parameterLimit?: number;
  /** Extended only: maximum bracket depth; deeper is a 400. Defaults to 32 (body-parser's). */
  depth?: number;
  /** Content type(s) to parse, as `req.is` understands them. Defaults to `application/x-www-form-urlencoded`. */
  type?: string | string[];
}

/**
 * Parse an `application/x-www-form-urlencoded` body into `req.body`.
 *
 * body-parser 1.20.6's behaviour, minus inflate: the charset must be UTF-8
 * (415 otherwise), more than `parameterLimit` parameters is a 413, the
 * extended parser caps nesting at `depth` (400 past it) and arrays at
 * `max(100, parameters)` entries, and an empty body is `{}`. Other content
 * types and bodiless requests pass through with `req.body` untouched.
 */
export function urlencoded(options: UrlencodedOptions = {}): Middleware {
  const extended = options.extended === true;
  const limit = toBytes(options.limit ?? "100kb", "urlencoded()");
  const parameterLimit = options.parameterLimit ?? 1000;
  if (!(parameterLimit >= 1)) {
    throw frameworkError(
      `urlencoded(): parameterLimit must be a positive number, received ${String(parameterLimit)}`,
      urlencoded,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  const depth = options.depth ?? 32;
  if (!(depth >= 0)) {
    throw frameworkError(
      `urlencoded(): depth must be zero or a positive number, received ${String(depth)}`,
      urlencoded,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  const types = normalizeTypes(options.type, "application/x-www-form-urlencoded");

  const parse = extended
    ? (body: string): ParsedQuery => {
        const count = parameterCount(body);
        if (count > parameterLimit) throw tooManyParameters(parameterLimit);
        return parseExtendedQuery(body, {
          depth,
          strictDepth: true,
          arrayLimit: Math.max(100, count),
          parameterLimit: Infinity,
        });
      }
    : (body: string): ParsedQuery => {
        if (parameterCount(body) > parameterLimit) throw tooManyParameters(parameterLimit);
        return parseSimple(body, undefined, undefined, { maxKeys: parameterLimit }) as ParsedQuery;
      };

  return function urlencodedMiddleware(req, _res, next) {
    if (!ZonixRequest.bodyIsOpen(req)) return next();
    if (!typeIs(req.headers, types)) {
      ZonixRequest.defaultBody(req);
      return next();
    }
    ZonixRequest.defaultBody(req);
    const charset = contentCharset(req.headers) ?? "utf-8";
    if (charset !== "utf-8" && charset !== "utf8") {
      return next(
        frameworkError(
          `Unsupported charset "${charset.toUpperCase()}"`,
          urlencodedMiddleware,
          ErrorCode.UNSUPPORTED_CHARSET,
          415,
        ),
      );
    }
    readBody(req, limit, (err, buf) => {
      if (err !== undefined) return next(err);
      if (buf.byteLength === 0) {
        ZonixRequest.bodyParsed(req, Object.create(null));
        return next();
      }
      let parsed: ParsedQuery;
      try {
        parsed = parse(stripBom(buf.toString("utf8")));
      } catch (e) {
        return next(e);
      }
      ZonixRequest.bodyParsed(req, parsed);
      next();
    });
  };
}

/** Count `&`-separated parameters, as body-parser does (an empty body is one). */
function parameterCount(body: string): number {
  let count = 1;
  let index = body.indexOf("&");
  while (index !== -1) {
    count++;
    index = body.indexOf("&", index + 1);
  }
  return count;
}

function tooManyParameters(limit: number): Error {
  return frameworkError(
    `Too many parameters: more than ${limit}`,
    tooManyParameters,
    ErrorCode.TOO_MANY_PARAMETERS,
    413,
  );
}

export function normalizeTypes(type: string | string[] | undefined, fallback: string): string[] {
  if (type === undefined) return [fallback];
  return Array.isArray(type) ? type : [type];
}
