import zonix from "../lib/index.js";

const app = zonix();

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/users/:id", (req, res) => {
  res.status(200).json({ id: req.params["id"], query: req.query });
});

app.get("/boom", () => {
  throw new Error("something went wrong inside the handler");
});

app.handleErr((err, _req, res) => {
  if (err.clientDisconnect) return;
  console.error("handled:", err.message);
  res.status(500).json({ error: "Something went wrong" });
});

const port = Number(process.env["PORT"] ?? 3000);
app.listen(port, () => console.log(`zonix example listening on http://localhost:${port}`));
