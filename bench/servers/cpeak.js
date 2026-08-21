// cpeak — the architectural reference (CLAUDE.md) — with the same scenarios as
// the other three servers, written the way its README does it.
import cpeak, { parseJSON } from "cpeak";
import { ensureFixtures } from "../fixtures.mjs";
import { scaleRoutes } from "./shared.mjs";

const { SMALL, LARGE } = ensureFixtures();

const server = cpeak();

server.route("get", "/", (req, res) => res.json({ hello: "world" }));

server.route("get", "/users/:id", (req, res) => res.json({ id: req.params.id }));

// 10-middleware chain, route-level, like the others.
const link = (req, res, next) => {
  next();
};
const chain = Array.from({ length: 10 }, () => link);
server.route("get", "/chain", ...chain, (req, res) => res.json({ ok: true }));

// Explicit MIME so the wire matches the other three (text/plain).
server.route("get", "/file/small", (req, res) => res.sendFile(SMALL, "text/plain"));
server.route("get", "/file/large", (req, res) => res.sendFile(LARGE, "text/plain"));

// Route-level JSON parsing, never global, for the same reason as zonix.js.
server.route("post", "/echo", parseJSON({ limit: 1024 * 1024 }), (req, res) => res.json(req.body));

for (const route of scaleRoutes()) {
  server.route("get", route.pattern, (req, res) => res.json({ id: req.params.id }));
}

// /no-such-route is deliberately absent: that is the 404 scenario.

server.listen(Number(process.env.PORT ?? 3005), () => process.send?.("ready"));
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
