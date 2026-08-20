// Route-table definitions shared by every bench server, so all four stay in
// lockstep and a scenario cannot accidentally measure different work in
// different frameworks.

/**
 * How many param routes to register, from BENCH_ROUTES.
 *
 * Zero by default: the small-table scenarios (hello, param, chain, 404, files)
 * keep the route table they have always been measured with, so their recorded
 * history stays comparable. The runner sets BENCH_ROUTES only for the
 * routes-200-param scenario, which starts its own server process.
 */
export const ROUTE_COUNT = Number(process.env.BENCH_ROUTES ?? 0);

/** `/api/v1/res0/:id` ... — the shape a real service's table has. */
export function scaleRoutes(count = ROUTE_COUNT) {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    pattern: `/api/v1/res${i}/:id`,
    express: `/api/v1/res${i}/:id`,
  }));
}

/**
 * The paths the routes-200-param scenario actually requests: ten positions
 * spread evenly across the table.
 *
 * Spread rather than a single path on purpose. A linear-scan router costs more
 * the later a route sits in the table, so benchmarking only the last route
 * flatters radix designs and only the first flatters linear ones. Cycling
 * across the table measures the average a real app sees.
 */
export function scaleProbePaths(count = 200, samples = 10) {
  const step = Math.max(1, Math.floor(count / samples));
  const paths = [];
  for (let i = 0; i < count && paths.length < samples; i += step) {
    paths.push(`/api/v1/res${i}/12345`);
  }
  return paths;
}

/** Body for post-json-echo: a realistic small API payload. */
export const ECHO_BODY = {
  id: 12345,
  name: "Ada Lovelace",
  email: "ada@example.com",
  active: true,
  tags: ["engineer", "mathematician"],
};

export const ECHO_BODY_JSON = JSON.stringify(ECHO_BODY);
