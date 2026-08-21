// Variant D: the true minimal candidate. Static Fastify import, an inline
// registration loop (no shared.mjs), no schema objects, no message listener.
// If THIS cliffs, the upstream repro is just "Fastify + N async param routes".
import Fastify from "fastify";

const app = Fastify({ logger: false });

const n = Number(process.env.BENCH_ROUTES ?? 200);
for (let i = 0; i < n; i++) {
  app.get(`/api/v1/res${i}/:id`, async (req) => ({ id: req.params.id }));
}

await app.listen({ port: Number(process.env.PORT ?? 3003), host: "127.0.0.1" });
process.send?.("ready");
