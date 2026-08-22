import { ErrorCode, frameworkError } from "../errors/index.js";
import type { Middleware } from "../types.js";
import { ZonixRequest } from "../request.js";
import { readBody, stripBom, toBytes } from "./read.js";

export interface ParseJSONOptions {
  /**
   * Maximum body size. A number is bytes; a string may use `b`, `kb`, `mb` or
   * `gb` (e.g. `"1mb"`). Defaults to `"1mb"`.
   */
  limit?: string | number;
  /**
   * Extra content types to treat as JSON, in addition to `application/json` and
   * any `*+json` type. Compared case-insensitively against the type only.
   */
  type?: string | string[];
}

/**
 * Parse a JSON request body into `req.body`.
 *
 * Requests without a JSON content type pass straight through untouched, so a
 * GET or a multipart upload is unaffected. An empty body parses to `{}`.
 * Oversized bodies fail with 413 and malformed JSON with 400 — both through
 * `next(err)`, so they land in the central error handler like everything else.
 */
export function parseJSON(options: ParseJSONOptions = {}): Middleware {
  const limit = toBytes(options.limit ?? "1mb", "parseJSON()");
  const extraTypes = normalizeTypes(options.type);

  return function parseJSONMiddleware(req, _res, next) {
    if (!ZonixRequest.bodyIsOpen(req)) return next();

    const contentType = req.headers["content-type"];
    if (contentType === undefined || !isJSONType(contentType, extraTypes)) {
      ZonixRequest.defaultBody(req);
      return next();
    }

    // Shared listener-based reader (decision 13): byte-exact limit, pause on
    // overflow, disconnect tagging, single chunk handed back without a copy.
    readBody(req, limit, (err, buf) => {
      if (err !== undefined) return next(err);
      if (buf.byteLength === 0) {
        ZonixRequest.bodyParsed(req, {});
        return next();
      }
      const text = stripBom(buf.toString("utf8"));
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return next(
          frameworkError(
            `Invalid JSON body: ${(e as Error).message}`,
            parseJSONMiddleware,
            ErrorCode.INVALID_JSON,
            400,
          ),
        );
      }
      ZonixRequest.bodyParsed(req, parsed);
      next();
    });
  };
}

function isJSONType(header: string, extraTypes: readonly string[]): boolean {
  const type = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type === "application/json" || type.endsWith("+json")) return true;
  return extraTypes.includes(type);
}

function normalizeTypes(type: string | string[] | undefined): readonly string[] {
  if (type === undefined) return [];
  const list = Array.isArray(type) ? type : [type];
  return list.map((t) => t.trim().toLowerCase());
}
