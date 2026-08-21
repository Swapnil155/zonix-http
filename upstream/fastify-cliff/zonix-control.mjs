// Control: does today's machine state flip table-size effects for zonix too?
// zonix was flat 6->400 in every recorded session; if it reads +/-20% today,
// the machine cannot adjudicate table-size effects for ANY framework today.
import autocannon from "autocannon";
import { spawn } from "node:child_process";

const ROOT = "C:/Users/ADMIN/Code/Node_Framework";
let port = 4700;

const run = (routes) =>
  new Promise((resolve) => {
    const bound = ++port;
    const child = spawn(process.execPath, ["bench/servers/zonix.js"], {
      cwd: ROOT,
      env: { ...process.env, BENCH_ROUTES: String(routes), PORT: String(bound) },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    child.once("message", async () => {
      const load = {
        url: `http://127.0.0.1:${bound}`,
        connections: 100,
        pipelining: 10,
        requests: [{ path: "/api/v1/res0/12345" }],
      };
      await autocannon({ ...load, duration: 2 });
      const result = await autocannon({ ...load, duration: 4 });
      child.kill();
      resolve(result.requests.average);
    });
  });

for (const order of [
  [6, 200],
  [200, 6],
]) {
  const out = {};
  for (let round = 1; round <= 3; round++) {
    for (const size of order) {
      (out[size] ??= []).push(await run(size));
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(
    `order [${order}]: 6r ${Math.round(median(out[6])).toLocaleString("en-US")} | ` +
      `200r ${Math.round(median(out[200])).toLocaleString("en-US")} | ` +
      `200/6 = ${(median(out[200]) / median(out[6])).toFixed(3)}`,
  );
}
