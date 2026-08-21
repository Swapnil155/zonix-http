// T-1 baseline: Fastify, default config, no response schemas (settled in
// session 5: schema is worth ~1% at this payload and no recorded matrix ever
// used one). The async bracket uses the same setImmediate-callback mechanism
// as every other server — reply.send from a plain callback, not an async
// function, so no server pays promise machinery the others do not.
import Fastify from "fastify";

const app = Fastify({ logger: false });

app.get("/", (req, reply) => {
  reply.send({ hello: "world" });
});

app.get("/echo", (req, reply) => {
  setImmediate(() => reply.send({ path: req.url }));
});

app
  .listen({ port: Number(process.env.PORT || 3113), host: "127.0.0.1" })
  .then(() => console.log("READY"));
