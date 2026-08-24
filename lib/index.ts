/**
 * The public barrel. Nothing outside `lib/` imports any other path.
 *
 * Structure rule 1: `internal/` and `errors/` import nothing from siblings;
 * core (`app.ts`, `request.ts`, `response.ts`, `router/`) imports only those;
 * feature directories import core and each other's entry points only.
 */
import createApp from "./app.js";
import { parseJSON } from "./body/json.js";
import { raw } from "./body/raw.js";
import { text } from "./body/text.js";
import { urlencoded } from "./body/urlencoded.js";
import { serveStatic } from "./middleware/serve-static.js";

export { Zonix } from "./app.js";

/**
 * The default export is the app factory, carrying the same helpers Express
 * hangs off its own (`express.json()`, `express.Router()`, `express.static()`
 * ...) so an Express app ports by changing only its import line.
 */
const zonix = Object.assign(createApp, {
  json: parseJSON,
  urlencoded,
  raw,
  text,
  static: serveStatic,
});
export default zonix;

export { ZonixRequest } from "./request.js";
export { Router, type RouterFactory } from "./router/mount.js";
export { ZonixResponse } from "./response.js";

export { parseJSON, type ParseJSONOptions } from "./body/json.js";
export { urlencoded, type UrlencodedOptions } from "./body/urlencoded.js";
export { raw, type RawOptions } from "./body/raw.js";
export { text, type TextOptions } from "./body/text.js";
export { parseExtendedQuery, type ExtendedQueryOptions } from "./query/extended.js";
export {
  cookieParser,
  type Cookies,
  type CookieValue,
  type SignedCookies,
} from "./cookies/parse.js";
export { createSerializer, escapeString, type Schema, type Serializer } from "./http/serialize.js";
export { cors, type CorsOptions, type OriginResolver } from "./middleware/cors.js";
export { serveStatic, type ServeStaticOptions } from "./middleware/serve-static.js";

export { ErrorCode, frameworkError, isClientDisconnect, type ZonixError } from "./errors/index.js";

export type {
  ErrorHandler,
  ErrorMiddleware,
  Handler,
  HandlerResult,
  HttpMethod,
  Middleware,
  Next,
  ParsedQuery,
  QueryParserOption,
  QueryValue,
  StringMap,
  TrustPredicate,
  TrustProxyOption,
  ZonixOptions,
  ZonixSettings,
} from "./types.js";
export { fresh, preconditionFailed, rangeFresh } from "./http/fresh.js";
export type { FreshRequestHeaders, FreshResponseHeaders } from "./http/fresh.js";
export { contentRange, parseRange } from "./http/range.js";
export type { Range, RangeOptions, Ranges } from "./http/range.js";
export { etag, type EtagMiddlewareOptions } from "./middleware/etag.js";
export { computeEtag, entityTag, statTag, type EtagOptions, type StatLike } from "./http/etag.js";
export type { EtagGenerator, EtagOption } from "./types.js";
export { compression, type CompressionOptions } from "./middleware/compression.js";
export { isCompressible } from "./http/mime.js";
