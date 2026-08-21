// Variant B: bench/servers/fastify.js with the fs/fixtures/file-routes strip.
// Everything else verbatim - schemas, chain hooks, echo, scaleRoutes loop, IPC.
import Fastify from "fastify";
import { scaleRoutes } from "../../../bench/servers/shared.mjs";

const app = Fastify({ logger: false });

const helloSchema = {};
const idSchema = {};
const okSchema = {};
const echoSchema = {};

app.get("/", helloSchema, async () => ({ hello: "world" }));

app.get("/users/:id", idSchema, async (req) => ({ id: req.params.id }));

const link = (req, reply, done) => {
  done();
};
app.get("/chain", { ...okSchema, onRequest: Array.from({ length: 10 }, () => link) }, async () => ({
  ok: true,
}));

app.post("/echo", echoSchema, async (req) => req.body);

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
