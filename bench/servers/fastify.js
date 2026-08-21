import { createReadStream, statSync } from "node:fs";
import Fastify from "fastify";
import { ensureFixtures } from "../fixtures.mjs";
import { scaleRoutes } from "./shared.mjs";

const { SMALL, LARGE } = ensureFixtures();

const app = Fastify({ logger: false });

// No response schemas: fast-json-stringify is NOT active in this variant.
const helloSchema = {};
const idSchema = {};
const okSchema = {};
const echoSchema = {};

app.get("/", helloSchema, async () => ({ hello: "world" }));

app.get("/users/:id", idSchema, async (req) => ({ id: req.params.id }));

// Fastify's equivalent of route-level middleware is an onRequest hook array.
const link = (req, reply, done) => {
  done();
};
app.get("/chain", { ...okSchema, onRequest: Array.from({ length: 10 }, () => link) }, async () => ({
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

// Fastify parses JSON bodies itself; there is no middleware to scope.
app.post("/echo", echoSchema, async (req) => req.body);

// BENCH_SHARED_HANDLER registers every scale route against ONE closure, to
// test whether per-route closure identity (not table size) drives the cost.
const scaleHandler = async (req) => ({ id: req.params.id });
for (const route of scaleRoutes()) {
  const handler = process.env.BENCH_SHARED_HANDLER
    ? scaleHandler
    : async (req) => ({ id: req.params.id });
  app.get(route.pattern, idSchema, handler);
}

await app.listen({ port: Number(process.env.PORT ?? 3003), host: "127.0.0.1" });
process.send?.("ready");
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
