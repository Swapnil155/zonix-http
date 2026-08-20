import { createReadStream, statSync } from "node:fs";
import Fastify from "fastify";
import { ensureFixtures } from "../fixtures.mjs";
import { scaleRoutes } from "./shared.mjs";

const { SMALL, LARGE } = ensureFixtures();

const app = Fastify({ logger: false });

// Response schemas activate fast-json-stringify, which is Fastify's real
// serialization ceiling. The plain variant declares none, so this pair isolates
// exactly what schema compilation is worth.
const helloSchema = {
  schema: { response: { 200: { type: "object", properties: { hello: { type: "string" } } } } },
};
const idSchema = {
  schema: { response: { 200: { type: "object", properties: { id: { type: "string" } } } } },
};
const okSchema = {
  schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } } },
};
const echoSchema = {
  schema: {
    response: {
      200: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          email: { type: "string" },
          active: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

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

for (const route of scaleRoutes()) {
  app.get(route.pattern, idSchema, async (req) => ({ id: req.params.id }));
}

await app.listen({ port: Number(process.env.PORT ?? 3004), host: "127.0.0.1" });
process.send?.("ready");
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
