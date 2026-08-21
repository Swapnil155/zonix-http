/**
 * The curated MIME table (decision 11).
 *
 * Not exhaustive coverage of 100+ entries — that would test the data, not the
 * code. These cover the lookup *rules*, which is where the bugs live: dotfiles,
 * extensionless paths, directory names containing dots, case, and the three
 * different shapes `res.type()` accepts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_MIME, lookupMime, resolveType } from "../../lib/http/mime.js";

describe("lookupMime", () => {
  test("resolves common types with a charset where it belongs", () => {
    assert.equal(lookupMime("index.html"), "text/html; charset=utf-8");
    assert.equal(lookupMime("app.js"), "text/javascript; charset=utf-8");
    assert.equal(lookupMime("data.json"), "application/json; charset=utf-8");
  });

  test("omits the charset for binary types", () => {
    assert.equal(lookupMime("logo.png"), "image/png");
    assert.equal(lookupMime("doc.pdf"), "application/pdf");
    assert.equal(lookupMime("font.woff2"), "font/woff2");
  });

  test("is case-insensitive on the extension", () => {
    assert.equal(lookupMime("PHOTO.JPEG"), "image/jpeg");
    assert.equal(lookupMime("Style.CSS"), "text/css; charset=utf-8");
  });

  test("returns undefined for an unknown extension", () => {
    assert.equal(lookupMime("archive.xyz"), undefined);
  });

  test("returns undefined for a path with no extension", () => {
    assert.equal(lookupMime("README"), undefined);
    assert.equal(lookupMime("/var/www/bin"), undefined);
  });

  test("treats a dotfile as having no extension", () => {
    // ".env" must not resolve as an "env" extension.
    assert.equal(lookupMime(".env"), undefined);
    assert.equal(lookupMime("/etc/.bashrc"), undefined);
  });

  test("a dot in a directory name does not become the extension", () => {
    assert.equal(lookupMime("/srv/v1.2/README"), undefined);
    assert.equal(lookupMime("/srv/v1.2/index.html"), "text/html; charset=utf-8");
  });

  test("handles both path separators", () => {
    assert.equal(lookupMime("C:\\www\\index.html"), "text/html; charset=utf-8");
    assert.equal(lookupMime("C:\\www.old\\README"), undefined);
  });
});

describe("resolveType", () => {
  test("passes a full type through untouched", () => {
    assert.equal(resolveType("text/plain"), "text/plain");
    assert.equal(resolveType("application/vnd.api+json"), "application/vnd.api+json");
  });

  test("expands a bare extension", () => {
    assert.equal(resolveType("html"), "text/html; charset=utf-8");
    assert.equal(resolveType("png"), "image/png");
  });

  test("accepts a leading dot", () => {
    assert.equal(resolveType(".png"), "image/png");
    assert.equal(resolveType(".html"), "text/html; charset=utf-8");
  });

  test("accepts a filename", () => {
    assert.equal(resolveType("report.pdf"), "application/pdf");
  });

  test("returns undefined for something unrecognisable", () => {
    assert.equal(resolveType("nope"), undefined);
  });
});

describe("DEFAULT_MIME", () => {
  test("is the octet-stream fallback static serving uses", () => {
    assert.equal(DEFAULT_MIME, "application/octet-stream");
  });
});
