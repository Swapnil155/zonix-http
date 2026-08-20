import { createReadStream } from "node:fs";
import { statSync } from "node:fs";
import Fastify from "fastify";
import { ensureFixtures } from "../fixtures.mjs";

const { SMALL, LARGE } = ensureFixtures();

const app = Fastify({ logger: false });

app.get("/", async () => ({ hello: "world" }));

app.get("/users/:id", async (req) => ({ id: req.params.id }));

// Fastify's equivalent of route-level middleware is an onRequest hook array.
const link = (req, reply, done) => {
  done();
};
app.get("/chain", { onRequest: Array.from({ length: 10 }, () => link) }, async () => ({
  ok: true,
}));

const sendFile = (path) => (req, reply) => {
  reply
    .type("text/plain; charset=utf-8")
    .header("content-length", statSync(path).size)
    .send(createReadStream(path));
};
app.get("/file/small", sendFile(SMALL));
app.get("/file/large", sendFile(LARGE));

await app.listen({ port: Number(process.env.PORT ?? 3003), host: "127.0.0.1" });
process.send?.("ready");
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
