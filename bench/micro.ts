// Router hot-path microbenchmark. One implementation per process.
//
//   npm run micro                    # measures lib/ (the candidate)
//   node bench/micro-ab.mjs          # alternating baseline/candidate processes
//
// Loading BOTH implementations into one process was tried and rejected: the
// shared `router.find` call site goes polymorphic and distorts both sides
// (identical code measured +-10%). One class per process keeps the call site
// monomorphic; bench/micro-ab.mjs then pairs alternating processes to cancel
// the JIT tier-up luck that makes any single process drift. Every result is
// folded into a checksum so V8 cannot eliminate the call being measured.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Router as CandidateRouter } from "../lib/router.js";
import type { Handler } from "../lib/types.js";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

// --impl=baseline measures the frozen snapshot instead of the working tree.
const impl = args.get("impl") ?? "candidate";
let Router = CandidateRouter;
if (impl === "baseline") {
  const baselinePath = fileURLToPath(new URL("./.baseline-src/router.ts", import.meta.url));
  if (!existsSync(baselinePath)) {
    console.error("No baseline sources. Run: node bench/snapshot.mjs");
    process.exit(1);
  }
  ({ Router } = (await import("./.baseline-src/router.js")) as { Router: typeof CandidateRouter });
}

const handler: Handler = () => undefined;

/** A route table shaped like a real app: mostly static, some params, one tail. */
function build(Router: typeof CandidateRouter) {
  const router = new Router();
  for (const path of [
    "/",
    "/health",
    "/metrics",
    "/api/v1/users",
    "/api/v1/orders",
    "/api/v1/products",
    "/api/v1/sessions",
    "/api/v1/webhooks/stripe",
    "/admin/dashboard",
    "/admin/settings",
  ]) {
    router.add("GET", path, [], handler);
  }
  router.add("GET", "/api/v1/users/:id", [], handler);
  router.add("GET", "/api/v1/users/:id/profile", [], handler);
  router.add("GET", "/api/v1/users/:id/settings", [], handler);
  router.add("GET", "/api/v1/orders/:orderId/items/:itemId", [], handler);
  router.add("GET", "/api/v1/orgs/:org/repos/:repo/issues/:number", [], handler);
  router.add("GET", "/files/*", [], handler);
  router.add("POST", "/api/v1/users", [], handler);
  router.add("PUT", "/api/v1/users/:id", [], handler);
  return router;
}

const CASES: ReadonlyArray<{ name: string; method: string; path: string }> = [
  { name: "find:static-shallow", method: "GET", path: "/health" },
  { name: "find:static-deep", method: "GET", path: "/api/v1/webhooks/stripe" },
  { name: "find:param-1", method: "GET", path: "/api/v1/users/12345" },
  { name: "find:param-2", method: "GET", path: "/api/v1/orders/999/items/42" },
  { name: "find:param-3-deep", method: "GET", path: "/api/v1/orgs/acme/repos/zonix/issues/7" },
  { name: "find:param-then-static", method: "GET", path: "/api/v1/users/12345/profile" },
  { name: "find:wildcard", method: "GET", path: "/files/assets/img/logo.png" },
  { name: "find:encoded", method: "GET", path: "/api/v1/users/a%20b" },
  { name: "find:miss", method: "GET", path: "/api/v1/nope/nothing" },
  { name: "find:trailing-slash", method: "GET", path: "/api/v1/users/" },
];

const router = build(Router);

// Consumed so nothing measured can be dead-code eliminated.
let checksum = 0;

function batch(c: (typeof CASES)[number], n: number) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    // Shape-agnostic on purpose: the baseline snapshot may predate a change to
    // RouteMatch. Consuming the result is what stops V8 eliminating the call.
    const match = router.find(c.method, c.path);
    checksum += match === undefined ? 1 : 2;
  }
  return Number(process.hrtime.bigint() - start);
}

const iterations = Number(args.get("iterations") ?? 200_000);
const repeats = Number(args.get("repeats") ?? 9);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return (s.length % 2 ? s[m] : ((s[m - 1] as number) + (s[m] as number)) / 2) as number;
};

const results: Record<string, number> = {};

for (const c of CASES) {
  batch(c, iterations); // warm this case's call site
  const rates: number[] = [];
  for (let r = 0; r < repeats; r++) {
    rates.push((iterations / batch(c, iterations)) * 1e9);
  }
  results[c.name] = median(rates);
}

if (args.has("json-stdout")) {
  console.log(JSON.stringify({ impl, results, checksum }));
} else {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  console.log("");
  console.log(`| Case (${impl}) | ops/s |`);
  console.log("| ---- | ----: |");
  for (const c of CASES) console.log(`| ${c.name} | ${fmt(results[c.name] as number)} |`);
  console.log("");
  console.log(
    `node ${process.version} · ${fmt(iterations)} iters x ${repeats} batches · median · checksum ${checksum}`,
  );
}
