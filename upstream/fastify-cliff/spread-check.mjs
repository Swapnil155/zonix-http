// Quietness gate for socket benches: the SAME config, back to back. If the
// spread exceeds 10% the machine is lying regardless of preflights (standing
// rule since the 40%-wobble session), and no isolation verdict may be drawn.
import autocannon from "autocannon";
import { spawn } from "node:child_process";

const ROOT = "C:/Users/ADMIN/Code/Node_Framework";
let port = 4400;

const run = () =>
  new Promise((resolve) => {
    const bound = ++port;
    const child = spawn(process.execPath, ["bench/servers/fastify.js"], {
      cwd: ROOT,
      env: { ...process.env, BENCH_ROUTES: "6", PORT: String(bound) },
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

const xs = [];
for (let i = 0; i < 4; i++) {
  xs.push(await run());
  console.log(`run ${i + 1}: ${Math.round(xs[i]).toLocaleString("en-US")} rps`);
  await new Promise((r) => setTimeout(r, 300));
}
const spread = ((Math.max(...xs) - Math.min(...xs)) / Math.min(...xs)) * 100;
console.log(
  `spread: ${spread.toFixed(1)}%  ->  ${spread > 10 ? "MACHINE IS LYING - stop" : "quiet enough to isolate"}`,
);
