import Fastify from "fastify";

const app = Fastify({ logger: false });

app.get("/", async () => ({ hello: "world" }));

await app.listen({ port: Number(process.env.PORT ?? 3003), host: "127.0.0.1" });
process.send?.("ready");
