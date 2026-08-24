// ZH-001 (traversal half) · CWE-22 · lexical path traversal out of a static root.
//
// Complements static-symlink.test.ts (which covers link-based escape). Here the
// escape is attempted through the request path itself: `../`, its encoded and
// double-encoded forms, backslashes, absolute paths, and null bytes. A file
// outside the root must never be served; dotfiles inside it fall through.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import { serveStatic } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

describe("ZH-001 static path traversal", () => {
  let root: string;
  let workDir: string;

  before(() => {
    workDir = mkdtempSync(join(tmpdir(), "zh001pt-"));
    root = join(workDir, "public");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "ok.txt"), "public file");
    writeFileSync(join(root, ".env"), "SECRET=should-not-be-served");
    // A secret sibling OUTSIDE the root, next to it.
    writeFileSync(join(workDir, "outside-secret.txt"), "TOP SECRET outside the root");
  });

  after(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* disposable */
    }
  });

  function app() {
    const a = makeApp();
    a.use(serveStatic(root));
    a.get("/*", (_req, res) => res.status(404).json({ fell: "through" }));
    return a;
  }

  test("a legitimate file is served (control)", async () => {
    await request(app().server).get("/ok.txt").expect(200, "public file");
  });

  const ESCAPES: [string, string][] = [
    ["plain ../", "/../outside-secret.txt"],
    ["nested ../", "/a/b/../../../outside-secret.txt"],
    ["encoded ../ (%2e%2e)", "/%2e%2e/outside-secret.txt"],
    ["encoded slash+dots", "/..%2Foutside-secret.txt"],
    ["double-encoded (%252e)", "/%252e%252e/outside-secret.txt"],
    ["backslash", "/..\\outside-secret.txt"],
    ["mixed sep", "/..%5Coutside-secret.txt"],
  ];

  for (const [name, path] of ESCAPES) {
    test(`traversal is blocked: ${name}`, async () => {
      const res = await request(app().server).get(path);
      assert.notEqual(res.status, 200, `${name} returned 200`);
      assert.doesNotMatch(res.text ?? "", /TOP SECRET/, `${name} leaked the outside secret`);
    });
  }

  test("an absolute path in the URL does not escape the root", async () => {
    const res = await request(app().server).get("//etc/passwd");
    assert.notEqual(res.status, 200);
    assert.doesNotMatch(res.text ?? "", /root:.*:0:0:/);
  });

  test("a null byte in the static path is rejected (not truncated)", async () => {
    const res = await request(app().server).get("/ok.txt%00.png");
    assert.notEqual(res.status, 200);
  });

  test("a dotfile inside the root is not served by default", async () => {
    const res = await request(app().server).get("/.env");
    assert.notEqual(res.status, 200);
    assert.doesNotMatch(res.text ?? "", /should-not-be-served/);
  });

  test("`/etc/passwd`-style request never returns a system file", async () => {
    const res = await request(app().server).get("/../../../../../../etc/passwd");
    assert.notEqual(res.status, 200);
    assert.doesNotMatch(res.text ?? "", /root:.*:0:0:/);
  });
});
