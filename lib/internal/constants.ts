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
