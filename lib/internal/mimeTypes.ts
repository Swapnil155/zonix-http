/**
 * Extension -> MIME type. Deliberately small: the ~30 types a web app actually
 * serves. Anything outside the table needs an explicit type argument, which is
 * a clearer failure than silently shipping `application/octet-stream`.
 */
const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  // text
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  // scripts and data
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  wasm: "application/wasm",
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  // fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  // media
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  // documents and archives
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
});

/** Fallback for `serveStatic`, which serves whatever is on disk rather than failing. */
export const DEFAULT_MIME = "application/octet-stream";

/**
 * Look up the MIME type for a path. Returns `undefined` for an unknown or
 * missing extension so callers can decide between erroring and falling back.
 */
export function lookupMime(filePath: string): string | undefined {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const dot = filePath.lastIndexOf(".");
  if (dot <= slash + 1) return undefined; // no extension, or a dotfile like ".env"
  return MIME_TYPES[filePath.slice(dot + 1).toLowerCase()];
}
