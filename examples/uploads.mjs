// File uploads (multipart/form-data) with busboy at the route.
//
// zonix-http has no multipart parser by design (keeps the audited surface
// small). Parse uploads at the route with busboy, enforce hard caps, and
// sanitize the filename before it ever touches the disk.
//
// Do NOT put zonix.json()/urlencoded() on an upload route — they would try to
// buffer the multipart body. busboy consumes the raw stream instead.
import zonix from "../dist/index.js";
import busboy from "busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// basename() drops any directory portion; we still reject a NUL byte (which
// could truncate a downstream path) and refuse an empty result.
function safeName(raw) {
  const name = basename(String(raw));
  if (name.length === 0 || name.includes("\0") || name === "." || name === "..") {
    return null;
  }
  return name;
}

export function uploadRoute(uploadDir) {
  return (req, res) => {
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
    });

    let aborted = false;
    const saved = [];

    const fail = (status, message) => {
      if (aborted) return;
      aborted = true;
      req.unpipe(bb);
      res.status(status).json({ error: message });
    };

    bb.on("file", (_field, stream, info) => {
      const name = safeName(info.filename);
      if (name === null) {
        stream.resume(); // drain and discard
        return fail(400, "invalid filename");
      }
      const dest = join(uploadDir, name);
      stream.on("limit", () => fail(413, "file exceeds 5 MB limit"));
      stream.pipe(createWriteStream(dest));
      saved.push({ name, dest });
    });

    bb.on("filesLimit", () => fail(413, "too many files"));
    bb.on("fieldsLimit", () => fail(413, "too many fields"));
    bb.on("error", () => fail(400, "malformed multipart body"));
    bb.on("close", () => {
      if (aborted) return;
      res.json({ uploaded: saved.map((f) => f.name) });
    });

    req.pipe(bb);
  };
}

// A complete app. multer is the higher-level option if you'd rather not wire
// busboy events yourself.
export async function makeApp() {
  const uploadDir = await mkdtemp(join(tmpdir(), "zx-upload-"));
  const app = zonix();
  app.post("/upload", uploadRoute(uploadDir));
  return { app, uploadDir, cleanup: () => rm(uploadDir, { recursive: true, force: true }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = await makeApp();
  app.listen(3000, () => console.log("upload demo on http://localhost:3000/upload"));
}
