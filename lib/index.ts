/**
 * The public barrel. Nothing outside `lib/` imports any other path.
 *
 * Structure rule 1: `internal/` and `errors/` import nothing from siblings;
 * core (`app.ts`, `request.ts`, `response.ts`, `router/`) imports only those;
 * feature directories import core and each other's entry points only.
 */
export { Zonix, default } from "./app.js";

export { ZonixRequest } from "./request.js";
export { ZonixResponse } from "./response.js";

export { parseJSON, type ParseJSONOptions } from "./body/json.js";
export { cookieParser } from "./cookies/parse.js";
export { createSerializer, escapeString, type Schema, type Serializer } from "./http/serialize.js";
export { cors, type CorsOptions, type OriginResolver } from "./middleware/cors.js";
export { serveStatic, type ServeStaticOptions } from "./middleware/serve-static.js";

export { ErrorCode, frameworkError, isClientDisconnect, type ZonixError } from "./errors/index.js";

export type {
  ErrorHandler,
  Handler,
  HandlerResult,
  HttpMethod,
  Middleware,
  Next,
  StringMap,
  TrustPredicate,
  TrustProxyOption,
  ZonixOptions,
  ZonixSettings,
} from "./types.js";
