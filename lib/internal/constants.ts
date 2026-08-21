/**
 * Shared constants. Imports nothing, by design: this is the bottom of the
 * dependency graph, so it can never take part in a cycle.
 */

/**
 * The frozen, null-prototype object handed out for every empty `params`,
 * `query` and `cookies`. One shared instance, frozen so a stray write can never
 * leak state from one request into the next.
 */
export const EMPTY: Readonly<Record<string, string>> = Object.freeze(
  Object.create(null) as Record<string, string>,
);

/**
 * Where an app hangs its compiled settings on its own `http.Server`.
 *
 * Requests reach them through `req.socket.server`, so a request that never
 * touches a compat accessor pays nothing: no per-request field, no assignment,
 * no closure. Performance rule 1, applied literally.
 */
export const kSettings = Symbol("zonix.settings");

/**
 * The shape stored under {@link kSettings}.
 *
 * Declared structurally rather than imported so this module keeps its "imports
 * nothing" property at runtime; `types.ts` re-exports the public alias.
 */
export interface AppSettings {
  trust: (address: string | undefined, hop: number) => boolean;
  subdomainOffset: number;
  /** Secret for signed cookies. Signing throws when it is absent. */
  cookieSecret?: string | undefined;
}

/** Settings for a request that cannot reach its app (detached socket, unit test). */
export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  trust: () => false,
  subdomainOffset: 2,
  cookieSecret: undefined,
});

/**
 * Resolve an app's settings from a socket.
 *
 * Requests and responses both reach the app this way — through
 * `socket.server` — so that nothing has to be attached per request.
 */
export function settingsOf(socket: unknown): AppSettings {
  const server = (socket as { server?: Record<symbol, AppSettings | undefined> } | null)?.server;
  return server?.[kSettings] ?? DEFAULT_SETTINGS;
}
