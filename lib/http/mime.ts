/**
 * Extension -> MIME type.
 *
 * A curated table (decision 11), not `mime-db`: ~120 types covering what a web
 * application actually serves, at a few kilobytes instead of a megabyte and
 * with no dependency. Backs `res.type()`, `req.is()`, `send` inference and
 * static serving.
 *
 * `charset=utf-8` is attached to the text-ish types where it is always correct
 * and omitted everywhere else, so a caller can use these values verbatim.
 */
const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  // --- markup and text -------------------------------------------------------
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  xhtml: "application/xhtml+xml; charset=utf-8",
  css: "text/css; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  text: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  rtf: "application/rtf",
  vtt: "text/vtt; charset=utf-8",
  ics: "text/calendar; charset=utf-8",
  vcf: "text/vcard; charset=utf-8",

  // --- structured data -------------------------------------------------------
  xml: "application/xml; charset=utf-8",
  rss: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
  json: "application/json; charset=utf-8",
  json5: "application/json5; charset=utf-8",
  jsonld: "application/ld+json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  geojson: "application/geo+json; charset=utf-8",
  map: "application/json; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  toml: "application/toml; charset=utf-8",
  csp: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",

  // --- scripts ---------------------------------------------------------------
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  jsx: "text/jsx; charset=utf-8",
  wasm: "application/wasm",

  // --- images ----------------------------------------------------------------
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  svgz: "image/svg+xml",
  ico: "image/x-icon",
  cur: "image/x-icon",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  jxl: "image/jxl",
  psd: "image/vnd.adobe.photoshop",

  // --- fonts -----------------------------------------------------------------
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  ttc: "font/collection",
  eot: "application/vnd.ms-fontobject",

  // --- audio -----------------------------------------------------------------
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
  flac: "audio/flac",
  mid: "audio/midi",
  midi: "audio/midi",

  // --- video -----------------------------------------------------------------
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  "3gp": "video/3gpp",

  // --- documents -------------------------------------------------------------
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",

  // --- archives and binaries -------------------------------------------------
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  bin: "application/octet-stream",
  exe: "application/octet-stream",
  dmg: "application/octet-stream",
  iso: "application/octet-stream",
  wasmmap: "application/json; charset=utf-8",

  // --- form encodings (no file extension, but req.is()/res.type() take them) --
  urlencoded: "application/x-www-form-urlencoded",
  multipart: "multipart/form-data",
});

/** Fallback for `serveStatic`, which serves whatever is on disk rather than failing. */
export const DEFAULT_MIME = "application/octet-stream";

/**
 * Look up the MIME type for a path or bare extension.
 *
 * Returns `undefined` for an unknown or missing extension so callers can choose
 * between erroring (`res.sendFile`) and falling back (`serveStatic`).
 */
export function lookupMime(filePath: string): string | undefined {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const dot = filePath.lastIndexOf(".");
  if (dot <= slash + 1) return undefined; // no extension, or a dotfile like ".env"
  return MIME_TYPES[filePath.slice(dot + 1).toLowerCase()];
}

/**
 * Resolve what `res.type()` was given: a bare extension (`"html"`), a path
 * (`"index.html"`), or a full type (`"text/html"`), which passes through.
 */
export function resolveType(value: string): string | undefined {
  if (value.includes("/")) return value;
  const bare = value.charCodeAt(0) === 0x2e /* . */ ? value.slice(1) : value;
  return MIME_TYPES[bare.toLowerCase()] ?? lookupMime(bare);
}

/**
 * Is a response of this Content-Type worth compressing?
 *
 * The rule the `compressible` package (mime-db's `compressible` flag) encodes,
 * as a predicate instead of a table: every `text/*`; JSON, JavaScript, XML and
 * their `+json`/`+xml` vendor suffixes; form bodies; SVG; WebAssembly. Binary
 * media (images, audio, video, fonts, archives, PDF, octet-stream) is not.
 * Parameters are ignored. Verified against the package by differential test.
 */
export function isCompressible(contentType: string): boolean {
  const semi = contentType.indexOf(";");
  const type = (semi === -1 ? contentType : contentType.slice(0, semi)).trim().toLowerCase();
  if (type.startsWith("text/")) return true;
  const slash = type.indexOf("/");
  if (slash === -1) return false;
  const subtype = type.slice(slash + 1);
  if (subtype.endsWith("+json") || subtype.endsWith("+xml")) return true;
  switch (type) {
    case "application/json":
    case "application/javascript":
    case "application/ecmascript":
    case "application/xml":
    case "application/x-www-form-urlencoded":
    case "application/wasm":
    case "application/rtf":
    case "application/toml":
    case "image/vnd.adobe.photoshop":
    case "application/x-javascript":
    case "application/x-httpd-php":
    case "application/x-sh":
    case "application/x-tar":
    case "application/ld+json":
    case "application/manifest+json":
    case "image/svg+xml":
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
    case "image/bmp":
    case "font/ttf":
    case "font/otf":
    case "application/vnd.ms-fontobject":
    case "application/x-font-ttf":
      return true;
    default:
      return false;
  }
}

/** Every distinct Content-Type value in the table (for tests and tooling). */
export const MIME_TYPE_VALUES: readonly string[] = Object.freeze([
  ...new Set(Object.values(MIME_TYPES)),
]);
