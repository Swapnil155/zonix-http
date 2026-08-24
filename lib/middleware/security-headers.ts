import type { Middleware } from "../types.js";

/**
 * Options for {@link securityHeaders}. Every field is opt-out (set `false`) or
 * overridable with a string. The three headers that are safe for virtually any
 * response are ON by default; the three that can break an app (CSP, HSTS,
 * Permissions-Policy) are OFF until you opt in — nothing here can silently break
 * a working site.
 */
export interface SecurityHeadersOptions {
  /**
   * `X-Content-Type-Options`. Default `"nosniff"` — stops browsers MIME-sniffing
   * a response into a more dangerous type. `false` omits it.
   */
  contentTypeOptions?: string | false;
  /**
   * `Referrer-Policy`. Default `"strict-origin-when-cross-origin"` (the modern
   * browser default, stated explicitly). `false` omits it.
   */
  referrerPolicy?: string | false;
  /**
   * `X-Frame-Options`. Default `"DENY"` — legacy clickjacking defense. `false`
   * omits it. For fine-grained control prefer a CSP `frame-ancestors` directive.
   */
  frameOptions?: string | false;
  /**
   * `Content-Security-Policy`. **Off by default** (a wrong CSP breaks a page).
   * Pass a full policy string to enable, e.g. `"default-src 'self'"`.
   */
  contentSecurityPolicy?: string | false;
  /**
   * `Strict-Transport-Security`. **Off by default** (only meaningful over HTTPS,
   * and a wrong max-age is hard to undo). Pass a value such as
   * `"max-age=15552000; includeSubDomains"` to enable. Never sent on plaintext
   * responses even when set.
   */
  strictTransportSecurity?: string | false;
  /**
   * `Permissions-Policy`. **Off by default.** Pass a policy string to enable,
   * e.g. `"geolocation=(), camera=()"`.
   */
  permissionsPolicy?: string | false;
}

const DEFAULT_CONTENT_TYPE_OPTIONS = "nosniff";
const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";
const DEFAULT_FRAME_OPTIONS = "DENY";

/** Resolve an on-by-default header value: explicit string wins, `false` disables, `undefined` uses the default. */
function resolve(value: string | false | undefined, fallback: string): string | undefined {
  if (value === false) return undefined;
  return value ?? fallback;
}

/**
 * Opt-in middleware that sets a baseline of security response headers.
 *
 * Secure-by-default without being able to break a working app: `nosniff`,
 * `Referrer-Policy` and `X-Frame-Options: DENY` are applied to every response;
 * `Content-Security-Policy`, `Strict-Transport-Security` and `Permissions-Policy`
 * are only sent when you provide a value. HSTS is additionally suppressed on
 * plaintext (non-`https`) responses, where it has no effect and only risks
 * pinning a bad policy during local development.
 *
 * A header a handler already set is left untouched, so a route can override the
 * baseline for its own response.
 *
 *     app.use(securityHeaders());
 *     app.use(securityHeaders({ contentSecurityPolicy: "default-src 'self'" }));
 */
export function securityHeaders(options: SecurityHeadersOptions = {}): Middleware {
  const contentTypeOptions = resolve(options.contentTypeOptions, DEFAULT_CONTENT_TYPE_OPTIONS);
  const referrerPolicy = resolve(options.referrerPolicy, DEFAULT_REFERRER_POLICY);
  const frameOptions = resolve(options.frameOptions, DEFAULT_FRAME_OPTIONS);
  const csp = options.contentSecurityPolicy || undefined;
  const hsts = options.strictTransportSecurity || undefined;
  const permissionsPolicy = options.permissionsPolicy || undefined;

  const setIfAbsent = (
    res: import("../response.js").ZonixResponse,
    name: string,
    value: string,
  ): void => {
    if (!res.hasHeader(name)) res.setHeader(name, value);
  };

  return function securityHeadersMiddleware(req, res, next) {
    if (contentTypeOptions !== undefined)
      setIfAbsent(res, "X-Content-Type-Options", contentTypeOptions);
    if (referrerPolicy !== undefined) setIfAbsent(res, "Referrer-Policy", referrerPolicy);
    if (frameOptions !== undefined) setIfAbsent(res, "X-Frame-Options", frameOptions);
    if (csp !== undefined) setIfAbsent(res, "Content-Security-Policy", csp);
    if (permissionsPolicy !== undefined) setIfAbsent(res, "Permissions-Policy", permissionsPolicy);
    // HSTS only over HTTPS: on plaintext it is ignored by browsers and only
    // risks pinning a policy set during local development.
    if (hsts !== undefined && req.secure) setIfAbsent(res, "Strict-Transport-Security", hsts);
    next();
  };
}
