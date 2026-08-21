/**
 * The Express-documentation corpus, registered once and mounted on both
 * frameworks.
 *
 * Every handler body here is **verbatim from expressjs.com**, with its source
 * noted. The point of sharing one registration function between the zonix suite
 * and the differential suite is that neither can drift from the other: the
 * bytes zonix produces are compared against the bytes real Express produces for
 * the identical handler.
 *
 * The `app` parameter is deliberately structurally typed rather than typed
 * against either framework — it is the shared subset, which is the thing under
 * test.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type DocsApp = {
  use: (mw: any) => unknown;
  get: (path: string, handler: any) => unknown;
  post: (path: string, handler: any) => unknown;
};

/** One replayable request. */
export interface DocsRequest {
  name: string;
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Register the corpus.
 *
 * `bodyParser` is passed in because the two frameworks name it differently
 * (`express.json()` vs `parseJSON()`) — that is the one line a real port would
 * change, and the compat promise is about handlers, not about the barrel.
 */
export function registerDocsRoutes(app: DocsApp, bodyParser: any): void {
  app.use(bodyParser);

  // res.locals is documented as populated by middleware, so it is set here.
  app.use((_req: any, res: any, next: any) => {
    res.locals.user = { name: "tobi" };
    res.locals.authenticated = true;
    next();
  });

  // --- expressjs.com/en/starter/hello-world.html -------------------------
  app.get("/", (req: any, res: any) => {
    res.send("Hello World!");
  });

  // --- expressjs.com/en/guide/routing.html (Route parameters) ------------
  app.get("/users/:userId/books/:bookId", (req: any, res: any) => {
    res.send(req.params);
  });

  // --- expressjs.com/en/5x/api.html#res.send -----------------------------
  app.get("/send/buffer", (req: any, res: any) => {
    res.send(Buffer.from("whoop"));
  });
  app.get("/send/json", (req: any, res: any) => {
    res.send({ some: "json" });
  });
  app.get("/send/html", (req: any, res: any) => {
    res.send("<p>some html</p>");
  });
  app.get("/send/404", (req: any, res: any) => {
    res.status(404).send("Sorry, we cannot find that!");
  });
  app.get("/send/500", (req: any, res: any) => {
    res.status(500).send({ error: "something blew up" });
  });

  // --- expressjs.com/en/5x/api.html#res.json -----------------------------
  app.get("/json/null", (req: any, res: any) => {
    res.json(null);
  });
  app.get("/json/user", (req: any, res: any) => {
    res.json({ user: "tobi" });
  });
  app.get("/json/error", (req: any, res: any) => {
    res.status(500).json({ error: "message" });
  });

  // --- expressjs.com/en/5x/api.html#res.set ------------------------------
  app.get("/set/one", (req: any, res: any) => {
    res.set("Content-Type", "text/plain");
    res.send("ok");
  });
  app.get("/set/many", (req: any, res: any) => {
    res.set({
      "Content-Type": "text/plain",
      "Content-Length": "123",
      ETag: "12345",
    });
    // The doc snippet is the res.set() call; a body of exactly the declared
    // length keeps the response well-formed so it can be compared on the wire.
    res.send("x".repeat(123));
  });

  // --- expressjs.com/en/5x/api.html#res.append ---------------------------
  app.get("/append", (req: any, res: any) => {
    res.append("Link", ["<http://localhost/>", "<http://localhost:3000/>"]);
    res.append("Set-Cookie", "foo=bar; Path=/; HttpOnly");
    res.append("Warning", "199 Miscellaneous warning");
    res.end();
  });

  // --- expressjs.com/en/5x/api.html#res.cookie ---------------------------
  app.get("/cookie/basic", (req: any, res: any) => {
    res.cookie("name", "tobi", { domain: ".example.com", path: "/admin", secure: true });
    res.cookie("rememberme", "1", { expires: new Date(Date.now() + 900000), httpOnly: true });
    res.end();
  });
  app.get("/cookie/object", (req: any, res: any) => {
    res.cookie("cart", { items: [1, 2, 3] });
    res.cookie("cart2", { items: [1, 2, 3] }, { maxAge: 900000 });
    res.end();
  });
  app.get("/cookie/signed", (req: any, res: any) => {
    res.cookie("name", "tobi", { signed: true });
    res.end();
  });
  // --- expressjs.com/en/5x/api.html#res.clearCookie ----------------------
  app.get("/cookie/clear", (req: any, res: any) => {
    res.cookie("name", "tobi", { path: "/admin" });
    res.clearCookie("name", { path: "/admin" });
    res.end();
  });

  // --- expressjs.com/en/5x/api.html#res.location -------------------------
  app.get("/location/path", (req: any, res: any) => {
    res.location("/foo/bar");
    res.end();
  });
  app.get("/location/absolute", (req: any, res: any) => {
    res.location("http://example.com");
    res.end();
  });

  // --- expressjs.com/en/5x/api.html#res.redirect -------------------------
  app.get("/redirect/path", (req: any, res: any) => {
    res.redirect("/foo/bar");
  });
  app.get("/redirect/absolute", (req: any, res: any) => {
    res.redirect("http://example.com");
  });
  app.get("/redirect/status-first", (req: any, res: any) => {
    res.redirect(301, "http://example.com");
  });
  app.get("/redirect/relative", (req: any, res: any) => {
    res.redirect("../login");
  });

  // --- expressjs.com/en/5x/api.html#res.type -----------------------------
  app.get("/type", (req: any, res: any) => {
    const seen: string[] = [];
    res.type(".html");
    seen.push(String(res.get("Content-Type")));
    res.type("html");
    seen.push(String(res.get("Content-Type")));
    res.type("json");
    seen.push(String(res.get("Content-Type")));
    res.type("application/json");
    seen.push(String(res.get("Content-Type")));
    res.type("png");
    seen.push(String(res.get("Content-Type")));
    res.json(seen);
  });

  // --- expressjs.com/en/5x/api.html#res.sendStatus -----------------------
  app.get("/status/200", (req: any, res: any) => {
    res.sendStatus(200);
  });
  app.get("/status/403", (req: any, res: any) => {
    res.sendStatus(403);
  });
  app.get("/status/404", (req: any, res: any) => {
    res.sendStatus(404);
  });
  app.get("/status/500", (req: any, res: any) => {
    res.sendStatus(500);
  });

  // --- expressjs.com/en/5x/api.html#res.links ----------------------------
  app.get("/links", (req: any, res: any) => {
    res.links({
      next: "http://api.example.com/users?page=2",
      last: "http://api.example.com/users?page=5",
    });
    res.end();
  });

  // --- expressjs.com/en/5x/api.html#res.vary -----------------------------
  app.get("/vary", (req: any, res: any) => {
    res.vary("User-Agent");
    res.end();
  });

  // --- expressjs.com/en/5x/api.html#res.locals ---------------------------
  app.get("/locals", (req: any, res: any) => {
    res.json({ user: res.locals.user, authenticated: res.locals.authenticated });
  });

  // --- expressjs.com/en/5x/api.html#req.get / #req.is --------------------
  app.post("/req/inspect", (req: any, res: any) => {
    res.json({
      contentType: req.get("Content-Type") ?? null,
      lowercase: req.get("content-type") ?? null,
      missing: req.get("Something") ?? null,
      isHtml: req.is("html"),
      isJson: req.is("json"),
      isApplicationJson: req.is("application/json"),
      isApplicationStar: req.is("application/*"),
    });
  });

  // --- #req.path / #req.originalUrl / #req.query -------------------------
  app.get("/search", (req: any, res: any) => {
    res.json({ path: req.path, originalUrl: req.originalUrl, q: req.query.q ?? null });
  });

  // --- #req.protocol / .secure / .hostname / .xhr ------------------------
  app.get("/req/env", (req: any, res: any) => {
    res.json({
      protocol: req.protocol,
      secure: req.secure,
      hostname: req.hostname,
      xhr: req.xhr,
      method: req.method,
    });
  });

  // --- expressjs.com/en/5x/api.html#express.json -------------------------
  app.post("/echo", (req: any, res: any) => {
    res.json(req.body);
  });
}

/** Every route above, as a replayable request. */
export const DOCS_REQUESTS: DocsRequest[] = [
  { name: "hello world", method: "GET", path: "/" },
  { name: "route params", method: "GET", path: "/users/34/books/8989" },
  { name: "send buffer", method: "GET", path: "/send/buffer" },
  { name: "send object", method: "GET", path: "/send/json" },
  { name: "send html", method: "GET", path: "/send/html" },
  { name: "send 404", method: "GET", path: "/send/404" },
  { name: "send 500", method: "GET", path: "/send/500" },
  { name: "json null", method: "GET", path: "/json/null" },
  { name: "json object", method: "GET", path: "/json/user" },
  { name: "json with status", method: "GET", path: "/json/error" },
  { name: "set one field", method: "GET", path: "/set/one" },
  { name: "set many fields", method: "GET", path: "/set/many" },
  { name: "append", method: "GET", path: "/append" },
  { name: "cookie with options", method: "GET", path: "/cookie/basic" },
  { name: "cookie object value", method: "GET", path: "/cookie/object" },
  { name: "cookie signed", method: "GET", path: "/cookie/signed" },
  { name: "clearCookie", method: "GET", path: "/cookie/clear" },
  { name: "location path", method: "GET", path: "/location/path" },
  { name: "location absolute", method: "GET", path: "/location/absolute" },
  { name: "redirect path", method: "GET", path: "/redirect/path" },
  { name: "redirect absolute", method: "GET", path: "/redirect/absolute" },
  { name: "redirect status first", method: "GET", path: "/redirect/status-first" },
  { name: "redirect relative", method: "GET", path: "/redirect/relative" },
  { name: "type", method: "GET", path: "/type" },
  { name: "sendStatus 200", method: "GET", path: "/status/200" },
  { name: "sendStatus 403", method: "GET", path: "/status/403" },
  { name: "sendStatus 404", method: "GET", path: "/status/404" },
  { name: "sendStatus 500", method: "GET", path: "/status/500" },
  { name: "links", method: "GET", path: "/links" },
  { name: "vary", method: "GET", path: "/vary" },
  { name: "locals", method: "GET", path: "/locals" },
  {
    name: "req.get / req.is",
    method: "POST",
    path: "/req/inspect",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  },
  { name: "req.path / originalUrl / query", method: "GET", path: "/search?q=tobi+ferret" },
  {
    name: "req env",
    method: "GET",
    path: "/req/env",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  },
  {
    name: "body echo",
    method: "POST",
    path: "/echo",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "tobi", tags: ["a", "b"] }),
  },
];
