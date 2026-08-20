/**
 * End-to-end demo of every public feature. Run it with `npm run example`, then:
 *
 *   curl localhost:3000/health
 *   curl "localhost:3000/users/42?verbose=1"
 *   curl -X POST localhost:3000/users -H "content-type: application/json" -d '{"name":"ada"}'
 *   curl localhost:3000/files/nested/deep.txt
 *   curl localhost:3000/download
 *   curl -i localhost:3000/boom
 *   curl -i localhost:3000/nope
 */
import { fileURLToPath } from "node:url";
import zonix, { cookieParser, cors, parseJSON, serveStatic } from "../lib/index.js";
import type { Middleware } from "../lib/index.js";

const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

const app = zonix();

// --- global middleware, in registration order -------------------------------

app.use((req, _res, next) => {
  const started = Date.now();
  req.once("end", () => console.log(`${req.method} ${req.url} (${Date.now() - started}ms)`));
  next();
});
app.use(cors({ origin: true, credentials: true }));
app.use(parseJSON({ limit: "1mb" }));
app.use(cookieParser());
// Serves ./public; a miss falls through to the routes below.
app.use(serveStatic(publicDir));

// --- route middleware, run only for the routes that list it -----------------

const requireApiKey: Middleware = (req, _res, next) => {
  if (req.headers["x-api-key"] === undefined) {
    return next(Object.assign(new Error("Missing X-API-Key header"), { status: 401 }));
  }
  next();
};

// --- routes -----------------------------------------------------------------

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/users/:id", (req, res) => {
  res.status(200).json({
    id: req.params["id"],
    query: req.query,
    cookies: req.cookies,
  });
});

app.post("/users", (req, res) => {
  res.status(201).json({ created: req.body });
});

app.delete("/users/:id", requireApiKey, (req, res) => {
  res.status(200).json({ deleted: req.params["id"] });
});

// Tail wildcard: /files/a/b.txt -> params["*"] === "a/b.txt"
app.get("/files/*", (req, res) => {
  return res.sendFile(publicDir + req.params["*"]);
});

app.get("/download", (_req, res) => {
  res.attachment("welcome.html");
  return res.sendFile(publicDir + "index.html");
});

app.get("/old-home", (_req, res) => res.redirect("/"));

// Both of these land in handleErr; neither needs a try/catch.
app.get("/boom", () => {
  throw new Error("something went wrong inside the handler");
});
app.get("/boom-async", async () => {
  await new Promise((r) => setTimeout(r, 10));
  throw new Error("something went wrong in an async handler");
});

// --- error handling and 404 -------------------------------------------------

app.handleErr((err, _req, res) => {
  if (err.clientDisconnect) return; // caller hung up, nothing to report
  console.error("handled:", err.message);
  const status = err.status ?? 500;
  res.status(status).json({ error: status < 500 ? err.message : "Something went wrong" });
});

app.fallback((req, res) => res.status(404).json({ error: `No route for ${req.path}` }));

const port = Number(process.env["PORT"] ?? 3000);
app.listen(port, () => console.log(`zonix example listening on http://localhost:${port}`));
