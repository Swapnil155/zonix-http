// Variant C: only the scale loop survives - no fixed routes at all. Keeps the
// schemas object, the shared.mjs import, and the IPC lifecycle verbatim.
import Fastify from "fastify";
import { scaleRoutes } from "../../../bench/servers/shared.mjs";

const app = Fastify({ logger: false });

const idSchema = {};

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
