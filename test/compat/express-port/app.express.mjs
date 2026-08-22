import express from "express";
// ---------------------------------------------------------------------------
// A small but real Express application: JSON + form body parsing, two mounted
// routers (one nested), route params and query strings, a static directory,
// an API-key middleware scoped to a mount, error middleware at router and app
// level, and a catch-all 404. The zonix copy of this file differs in its
// first line only (the exit test asserts that).
// ---------------------------------------------------------------------------

export function createApp({ staticDir }) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("query parser", "extended"); // Express 4 default; explicit because Express 5 and zonix default to "simple"

  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/assets", express.static(staticDir));

  // --- users router -------------------------------------------------------
  const users = express.Router();
  const db = new Map([
    ["1", { id: "1", name: "Ada" }],
    ["2", { id: "2", name: "Grace" }],
  ]);

  users.get("/", (req, res) => {
    const limit = Number(req.query.limit ?? 10);
    res.json({ users: [...db.values()].slice(0, limit), baseUrl: req.baseUrl });
  });

  users.get("/:id", (req, res, next) => {
    const user = db.get(req.params.id);
    if (!user) {
      const err = new Error(`no user ${req.params.id}`);
      err.status = 404;
      return next(err);
    }
    res.json(user);
  });

  users.post("/", (req, res) => {
    const { name } = req.body ?? {};
    if (typeof name !== "string" || name.length === 0) {
      return res.status(422).json({ error: "name required" });
    }
    const id = String(db.size + 1);
    db.set(id, { id, name });
    res.status(201).set("Location", `${req.baseUrl}/${id}`).json({ id, name });
  });

  users.post("/form", (req, res) => {
    res.type("text").send(`form: ${JSON.stringify(req.body)}`);
  });

  users.use((err, req, res, next) => {
    if (err.status === 404) return res.status(404).json({ error: err.message, scope: "users" });
    next(err);
  });

  // --- admin router, nested under /api -----------------------------------
  const admin = express.Router();
  admin.use((req, res, next) => {
    if (req.get("x-api-key") !== "secret") {
      return res.status(401).json({ error: "unauthorized", path: req.path, url: req.originalUrl });
    }
    next();
  });
  admin.get("/stats", (req, res) => res.json({ users: db.size, baseUrl: req.baseUrl }));
  admin.get("/boom", () => {
    throw new Error("admin exploded");
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.set("X-Api-Version", "1");
    next();
  });
  api.use("/users", users);
  api.use("/admin", admin);
  api.get("/echo", (req, res) => {
    res.json({
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      query: req.query,
    });
  });

  app.use("/api", api);

  app.get("/", (req, res) => res.send("<h1>Home</h1>"));
  app.get("/health", (req, res) => res.json({ ok: true }));
  app.post("/echo", (req, res) => res.json({ body: req.body, type: req.get("content-type") }));

  // Catch-all 404 and the final error handler.
  app.all("/*", (req, res) => res.status(404).json({ error: `not found: ${req.originalUrl}` }));
  app.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return app;
}
