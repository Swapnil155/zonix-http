import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.json({ hello: "world" });
});

app.listen(Number(process.env.PORT ?? 3002), () => {
  process.send?.("ready");
});
