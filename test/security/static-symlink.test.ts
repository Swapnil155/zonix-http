// ZH-001 · CWE-22/59 · symlink / path escape from a static root.
//
// The lexical containment check (path.resolve + startsWith) blocks `../` but not
// a symlink INSIDE the root that points OUT of it. This suite proves that such a
// symlink can never leak a file (or directory) from outside the root. It fails
// against the pre-fix code (which stat()'d through the symlink) and passes once
// the served path is realpath-validated against the real root.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import { serveStatic } from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

// A symlink whose creation may need privilege on Windows; skip a case cleanly
// if the OS refuses, but never skip the directory-junction case (always allowed).
function trySymlink(target: string, linkPath: string, type: "file" | "dir" | "junction"): boolean {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return true; // already created by an earlier case
    if (code === "EPERM" || code === "EACCES") return false; // Windows without privilege
    throw err;
  }
}

describe("ZH-001 static symlink / path escape", () => {
  let root: string;
  let outside: string;
  let secretFile: string;

  before(() => {
    const work = mkdtempSync(join(tmpdir(), "zh001-"));
    root = join(work, "public");
    outside = join(work, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "ok.txt"), "public file");
    secretFile = join(outside, "secret.txt");
    writeFileSync(secretFile, "TOP SECRET - outside the root");
    writeFileSync(join(outside, "index.html"), "<h1>outside index</h1>");
  });

  after(() => {
    // Best-effort; the temp dir is disposable.
    try {
      rmSync(join(root, ".."), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test("a legitimate file inside the root is still served", async () => {
    const app = makeApp();
    app.use(serveStatic(root));
    await request(app.server).get("/ok.txt").expect(200, "public file");
  });

  test("a symlink to a FILE outside the root must not be served (403, never the secret)", async (t) => {
    const link = join(root, "leak.txt");
    if (!trySymlink(secretFile, link, "file")) {
      t.skip("OS refused file symlink creation (Windows without privilege)");
      return;
    }
    const app = makeApp();
    app.use(serveStatic(root));
    const res = await request(app.server).get("/leak.txt");
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    assert.doesNotMatch(res.text, /TOP SECRET/, "secret file contents leaked through symlink");
  });

  test("a symlink to a DIRECTORY outside the root must not traverse into it", async (t) => {
    // Directory junctions are permitted on Windows without privilege; on POSIX a
    // dir symlink is used. This case therefore always runs somewhere.
    const link = join(root, "escape");
    const type = process.platform === "win32" ? "junction" : "dir";
    if (!trySymlink(outside, link, type)) {
      t.skip("OS refused directory link creation");
      return;
    }
    const app = makeApp();
    app.use(serveStatic(root));
    const res = await request(app.server).get("/escape/secret.txt");
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    assert.doesNotMatch(res.text, /TOP SECRET/, "secret reached through directory symlink");
  });

  test("the same escape is blocked on the memory-cache path", async (t) => {
    const link = join(root, "escape-cached");
    const type = process.platform === "win32" ? "junction" : "dir";
    if (!trySymlink(outside, link, type)) {
      t.skip("OS refused directory link creation");
      return;
    }
    const app = makeApp();
    app.use(serveStatic(root, { cache: { maxBytes: 1024 * 1024 } }));
    const res = await request(app.server).get("/escape-cached/secret.txt");
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    assert.doesNotMatch(res.text, /TOP SECRET/, "secret reached through cached symlink path");
  });

  test("a symlinked index resolving outside the root is not served for a dir request", async (t) => {
    const link = join(root, "escape");
    const type = process.platform === "win32" ? "junction" : "dir";
    // Reuses the escape link if present; recreate defensively.
    trySymlink(outside, link, type);
    const app = makeApp();
    app.use(serveStatic(root));
    const res = await request(app.server).get("/escape/");
    assert.notEqual(res.status, 200);
    assert.doesNotMatch(res.text, /outside index/, "outside index.html served via symlinked dir");
  });
});
