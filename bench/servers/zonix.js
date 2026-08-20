// Benchmark server. The same scenarios are implemented in every server here,
// as idiomatically as each framework allows.
import { ensureFixtures } from "../fixtures.mjs";
import { scaleRoutes } from "./shared.mjs";

// ZONIX_ENTRY lets bench/ab.mjs point this same server at two different builds
// so a candidate can be measured against its baseline in one session.
const { default: zonix, parseJSON } = await import(
  process.env.ZONIX_ENTRY ?? "../../dist/index.js"
);

const { SMALL, LARGE } = ensureFixtures();

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

app.get("/file/small", (req, res) => res.sendFile(SMALL));
app.get("/file/large", (req, res) => res.sendFile(LARGE));

// Body parsing is route-level, never global: a global would take every other
// route off the no-middleware fast path and quietly change their numbers.
app.post("/echo", parseJSON({ limit: "1mb" }), (req, res) => {
  res.json(req.body);
});

// Only registered for the routes-200-param scenario (BENCH_ROUTES).
for (const route of scaleRoutes()) {
  app.get(route.pattern, (req, res) => {
    res.json({ id: req.params.id });
  });
}

// /no-such-route is deliberately absent: that is the 404 scenario.

app.listen(Number(process.env.PORT ?? 3001), () => process.send?.("ready"));
process.on("message", (m) => {
  if (m === "shutdown") process.exit(0);
});
