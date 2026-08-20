import express from "express";
import { ensureFixtures } from "../fixtures.mjs";

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

app.listen(Number(process.env.PORT ?? 3002), () => process.send?.("ready"));
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
