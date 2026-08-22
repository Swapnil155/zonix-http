// MH-1: a Fastify server that spans, by env knobs, the whole distance between
// bench/servers/fastify.js (the configuration that never reached the fast
// mode at 200 routes) and upstream/fastify-cliff/repro.mjs (the minimal server
// that reaches it at any table size).
//
//   FIXED=hello,users,chain,files,echo   which fixed routes to register ("" = none)
//   SCALE=200                            param routes /api/v1/res{i}/:id
//   HANDLER=async|callback               scale-route handler style
//   PORT=...
import { createReadStream, statSync } from "node:fs";
import Fastify from "fastify";

const FIXED = new Set((process.env.FIXED ?? "").split(",").filter(Boolean));
const SCALE = Number(process.env.SCALE ?? 200);
const CALLBACK = process.env.HANDLER === "callback";

const app = Fastify({ logger: false });

if (FIXED.has("hello")) app.get("/", {}, async () => ({ hello: "world" }));
if (FIXED.has("users")) app.get("/users/:id", {}, async (req) => ({ id: req.params.id }));
if (FIXED.has("chain")) {
  const link = (req, reply, done) => {
    done();
  };
  app.get("/chain", { onRequest: Array.from({ length: 10 }, () => link) }, async () => ({
    ok: true,
  }));
}
if (FIXED.has("files")) {
  const { ensureFixtures } = await import("../fixtures.mjs");
  const { SMALL, LARGE } = ensureFixtures();
  const sendFile = (path) => (req, reply) => {
    reply
      .type("text/plain; charset=utf-8")
      .header("content-length", statSync(path).size)
      .send(createReadStream(path));
  };
  app.get("/file/small", sendFile(SMALL));
  app.get("/file/large", sendFile(LARGE));
}
if (FIXED.has("echo")) app.post("/echo", {}, async (req) => req.body);

for (let i = 0; i < SCALE; i++) {
  const pattern = `/api/v1/res${i}/:id`;
  if (CALLBACK) app.get(pattern, {}, (req, reply) => reply.send({ id: req.params.id }));
  else app.get(pattern, {}, async (req) => ({ id: req.params.id }));
}

await app.listen({ port: Number(process.env.PORT ?? 3003), host: "127.0.0.1" });
process.send?.("ready");
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
