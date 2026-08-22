// Benchmark server. The same scenarios are implemented in every server here,
// as idiomatically as each framework allows.
import { ensureFixtures } from "../fixtures.mjs";
import { scaleRoutes } from "./shared.mjs";

// ZONIX_ENTRY lets bench/ab.mjs point this same server at two different builds
// so a candidate can be measured against its baseline in one session.
const {
  default: zonix,
  parseJSON,
  serveStatic,
} = await import(process.env.ZONIX_ENTRY ?? "../../dist/index.js");

const { SMALL, LARGE, STATIC_ROOT } = ensureFixtures();

const app = zonix({ dev: false });

app.get("/", (req, res) => {
  res.json({ hello: "world" });
});

app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});

// 10-middleware chain, route-level so only this scenario pays for it.
const link = (req, res, next) => {
  next();
};
const chain = Array.from({ length: 10 }, () => link);
app.get("/chain", ...chain, (req, res) => {
  res.json({ ok: true });
});

// ZONIX_STATIC_CACHE=1 is the M1 "cache-on" row (labeled opt-in): the same
// bytes, same Content-Type and same Last-Modified, served through
// `serveStatic({ cache })` sized to hold both fixtures. Default row: sendFile.
if (process.env.ZONIX_STATIC_CACHE) {
  const cached = serveStatic(STATIC_ROOT, { cache: { maxBytes: 4 * 1024 * 1024 } });
  const asText = (req, res, next) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    next();
  };
  app.get("/file/small", asText, cached);
  app.get("/file/large", asText, cached);
} else {
  app.get("/file/small", (req, res) => res.sendFile(SMALL));
  app.get("/file/large", (req, res) => res.sendFile(LARGE));
}

// Body parsing is route-level, never global: a global would take every other
// route off the no-middleware fast path and quietly change their numbers.
app.post("/echo", parseJSON({ limit: "1mb" }), (req, res) => {
  res.json(req.body);
});

// Only registered for the routes-200-param scenario (BENCH_ROUTES).
// Mirrors the fastify variant so the comparison stays symmetric.
const scaleHandler = (req, res) => {
  res.json({ id: req.params.id });
};
for (const route of scaleRoutes()) {
  const handler = process.env.BENCH_SHARED_HANDLER
    ? scaleHandler
    : (req, res) => {
        res.json({ id: req.params.id });
      };
  app.get(route.pattern, handler);
}

// /no-such-route is deliberately absent: that is the 404 scenario.

app.listen(Number(process.env.PORT ?? 3001), () => process.send?.("ready"));
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
