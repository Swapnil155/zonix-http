// Variant E: variant D with callback-style handlers (reply.send, no promise).
// If D cliffs and E does not, the cliff lives in Fastify's promise path -
// consistent with the nextTick growth in the profiles.
import Fastify from "fastify";

const app = Fastify({ logger: false });

const n = Number(process.env.BENCH_ROUTES ?? 200);
for (let i = 0; i < n; i++) {
  app.get(`/api/v1/res${i}/:id`, (req, reply) => reply.send({ id: req.params.id }));
}

await app.listen({ port: Number(process.env.PORT ?? 3003), host: "127.0.0.1" });
process.send?.("ready");
