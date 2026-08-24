// Compressed request bodies. zonix-http never silently inflates a
// `Content-Encoding: gzip` request body — that is deliberate: automatic
// decompression is a decompression-bomb surface. If a client will send
// compressed bodies, opt in with a small middleware whose byte cap on the
// DECOMPRESSED stream IS the bomb protection: a 1 KB payload that expands to
// gigabytes is destroyed the moment it crosses the cap.
import zonix from "../dist/index.js";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";

const DECODERS = {
  gzip: createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
};

export function inflateRequest({ limit = 10 * 1024 * 1024 } = {}) {
  return (req, res, next) => {
    const encoding = (req.headers["content-encoding"] ?? "identity").toLowerCase();
    if (encoding === "identity") return next(); // nothing to do

    const make = DECODERS[encoding];
    if (make === undefined) {
      return res.status(415).json({ error: `unsupported content-encoding: ${encoding}` });
    }

    const decoder = make();
    const chunks = [];
    let total = 0;
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      fn();
    };

    decoder.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        req.unpipe(decoder);
        decoder.destroy(); // stop inflating — the bomb never fully expands
        finish(() => res.status(413).json({ error: "decompressed body too large" }));
        return;
      }
      chunks.push(chunk);
    });
    decoder.on("end", () =>
      finish(() => {
        req.rawBody = Buffer.concat(chunks); // hand the plaintext downstream
        next();
      }),
    );
    decoder.on("error", () => finish(() => res.status(400).json({ error: "malformed body" })));

    req.pipe(decoder);
  };
}

export function makeApp(limit) {
  const app = zonix();
  app.post("/ingest", inflateRequest({ limit }), (req, res) => {
    res.json({ bytes: req.rawBody.length });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  makeApp().listen(3000, () => console.log("compressed-body demo on http://localhost:3000/ingest"));
}
