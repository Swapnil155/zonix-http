import express from "express";
import { ensureFixtures } from "../fixtures.mjs";
import { scaleRoutes } from "./shared.mjs";

const { SMALL, LARGE } = ensureFixtures();

const app = express();

app.get("/", (req, res) => {
  res.json({ hello: "world" });
});

app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});

const link = (req, res, next) => {
  next();
};
const chain = Array.from({ length: 10 }, () => link);
app.get("/chain", ...chain, (req, res) => {
  res.json({ ok: true });
});

app.get("/file/small", (req, res) => res.sendFile(SMALL));
app.get("/file/large", (req, res) => res.sendFile(LARGE));

// Route-level, to match how the other servers scope body parsing.
app.post("/echo", express.json({ limit: "1mb" }), (req, res) => {
  res.json(req.body);
});

for (const route of scaleRoutes()) {
  app.get(route.express, (req, res) => {
    res.json({ id: req.params.id });
  });
}

app.listen(Number(process.env.PORT ?? 3002), () => process.send?.("ready"));
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
