/**
 * Content-Disposition, verified differentially against the real
 * `content-disposition` package.
 *
 * Structure rule 2: when behaviour is in doubt, diff against the original
 * package — it is the compat oracle. The package is a devDependency used only
 * here; nothing in `lib/` depends on it.
 *
 * The one intended difference is the basename rule: we treat `\` as a path
 * separator on every platform, the package uses `path.basename`, which is
 * platform-dependent. Those cases are asserted explicitly rather than
 * differentially.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
// The oracle is pinned to the version Express itself depends on (0.5.x), not
// the newer major, which has a different API.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { createRequire } from "node:module";
const expressContentDisposition = createRequire(import.meta.url)("content-disposition") as (
  filename?: string,
  options?: { type?: string; fallback?: string | boolean },
) => string;
import { contentDisposition } from "../../lib/http/content-disposition.js";
import { makeRng, pickSeed } from "../fuzz/rng.js";

/** Names with no path separator, where we and the package must agree exactly. */
const CORPUS = [
  "report.pdf",
  "my report.pdf",
  'quote".pdf',
  "rapporté.pdf",
  "日本語.pdf",
  "emoji😀.pdf",
  "semi;colon.pdf",
  "tab\there.pdf",
  "crlf\r\ninjected.pdf",
  "percent%20.pdf",
  "star*.pdf",
  "plus+.pdf",
  "paren(1).pdf",
  "'apostrophe'.pdf",
  "comma,name.pdf",
  "equals=name.pdf",
  "bracket[1].pdf",
  "brace{1}.pdf",
  "at@name.pdf",
  "colon:name.pdf",
  "question?.pdf",
  "less<greater>.pdf",
  "naïve café.txt",
  "ünïcödé.txt",
  "Ω.txt",
  "a".repeat(200) + ".pdf",
  "no-extension",
  "..dots..",
  "\u00ff-latin1-edge.txt",
  "\u0100-beyond-latin1.txt",
];

describe("contentDisposition: differential against the real package", () => {
  for (const name of CORPUS) {
    test(`matches for ${JSON.stringify(name)}`, () => {
      assert.equal(contentDisposition(name), expressContentDisposition(name));
    });
  }

  test("matches with no filename", () => {
    assert.equal(contentDisposition(), expressContentDisposition());
  });

  test("matches for inline", () => {
    assert.equal(
      contentDisposition("report.pdf", { type: "inline" }),
      expressContentDisposition("report.pdf", { type: "inline" }),
    );
  });

  test("matches with the fallback disabled", () => {
    assert.equal(
      contentDisposition("日本語.pdf", { fallback: false }),
      expressContentDisposition("日本語.pdf", { fallback: false }),
    );
  });

  test("matches with an explicit fallback", () => {
    assert.equal(
      contentDisposition("日本語.pdf", { fallback: "japanese.pdf" }),
      expressContentDisposition("日本語.pdf", { fallback: "japanese.pdf" }),
    );
  });

  test("fuzz: 2000 generated names agree with the package", () => {
    const seed = pickSeed();
    const rng = makeRng(seed);
    // Deliberately weighted toward the characters that break naive encoders.
    const pool = [
      ..."abcXYZ019",
      ".",
      " ",
      '"',
      "'",
      ";",
      ",",
      "=",
      "*",
      "+",
      "%",
      "(",
      ")",
      "[",
      "]",
      "{",
      "}",
      "<",
      ">",
      "?",
      "@",
      ":",
      "\t",
      "\r",
      "\n",
      "é",
      "ÿ",
      "Ā",
      "日",
      "😀",
      "\u0000",
      "\u007f",
      "\u00a0",
    ];

    for (let i = 0; i < 2000; i++) {
      let name = "";
      const length = 1 + rng.int(12);
      for (let c = 0; c < length; c++) name += rng.pick(pool);
      // Separators and drive-letter prefixes are the intended difference.
      if (name.includes("/") || name.includes("\\")) continue;
      if (/^[A-Za-z]:/.test(name)) continue;

      let expected: string;
      try {
        expected = expressContentDisposition(name);
      } catch {
        continue; // the package rejects it; our behaviour there is asserted below
      }
      assert.equal(
        contentDisposition(name),
        expected,
        `mismatch for ${JSON.stringify(name)} (replay with SEED=${seed})`,
      );
    }
  });
});

describe("contentDisposition: the deliberate basename deviation", () => {
  test("strips a POSIX path", () => {
    assert.equal(contentDisposition("/etc/passwd"), 'attachment; filename="passwd"');
  });

  test("strips a Windows path on every platform", () => {
    // path.basename would keep this intact on POSIX, leaving a path in the
    // header. We treat backslash as a separator everywhere.
    assert.equal(contentDisposition("C:\\secrets\\dump.pdf"), 'attachment; filename="dump.pdf"');
    assert.equal(contentDisposition("..\\..\\secret.pdf"), 'attachment; filename="secret.pdf"');
  });

  test("ignores trailing separators", () => {
    assert.equal(contentDisposition("dir/name.pdf/"), 'attachment; filename="name.pdf"');
  });
});

describe("contentDisposition: the traps", () => {
  test("a quote is escaped, never deleted", () => {
    assert.equal(contentDisposition('quote".pdf'), 'attachment; filename="quote\\".pdf"');
  });

  test("a trailing separator is not part of the name", () => {
    assert.equal(contentDisposition("a\\"), 'attachment; filename="a"');
    assert.equal(contentDisposition("a/"), 'attachment; filename="a"');
  });

  test("CRLF cannot break out of the header", () => {
    const header = contentDisposition("crlf\r\ninjected.pdf");
    assert.ok(!header.includes("\r"), header);
    assert.ok(!header.includes("\n"), header);
    assert.match(header, /filename\*=UTF-8''crlf%0D%0Ainjected\.pdf/);
  });

  test("a plain ASCII name gets only the simple form", () => {
    assert.equal(contentDisposition("report.pdf"), 'attachment; filename="report.pdf"');
  });

  test("an existing percent escape still forces the extended form", () => {
    // Otherwise a client decodes "%20" back into a space.
    assert.equal(
      contentDisposition("percent%20.pdf"),
      "attachment; filename=\"percent%20.pdf\"; filename*=UTF-8''percent%2520.pdf",
    );
  });

  test("an apostrophe is percent-encoded in the extended form", () => {
    // Left literal it would terminate the charset'language' prefix. Needs a
    // non-Latin-1 character to force the extended form in the first place -
    // "ü" and friends are Latin-1 and stay in the simple quoted form.
    const header = contentDisposition("日本'.txt");
    assert.match(header, /filename\*=UTF-8''/);
    assert.equal(header.split("filename*=UTF-8''")[1]?.includes("'"), false, header);
  });

  test("a non-token type is rejected", () => {
    assert.throws(() => contentDisposition("a.pdf", { type: "not a token" }), /must be a token/);
  });

  test("a non-Latin-1 fallback is rejected", () => {
    assert.throws(() => contentDisposition("a.pdf", { fallback: "日本.pdf" }), /ISO-8859-1/);
  });
});
