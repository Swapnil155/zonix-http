/**
 * Content negotiation — the inlined equivalent of `negotiator@0.6.3`
 * (structure rule 2), pinned to it by `test/http/negotiation.test.ts`
 * (differential) and `test/fuzz/accept.fuzz.ts` (10k seeded inputs, byte
 * parity). Linear parsers only (decision 11).
 *
 * This is the entry point; feature code imports from here and nowhere
 * deeper. `req.accepts()` and friends, `res.format`, and static serving's
 * encoding choice all route through these four functions.
 */
export { preferredMediaTypes } from "./media-type.js";
export { preferredEncodings } from "./encoding.js";
export { preferredLanguages } from "./language.js";
export { preferredCharsets } from "./charset.js";
export { isWhitespace } from "./shared.js";
