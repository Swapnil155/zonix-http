// Drive one server with K independent client PROCESSES and sum their rps.
// If the sum rises with K, the load generator was the bottleneck and any
// single-client ratio is a floor, not the truth.
import { spawn } from "node:child_process";

const FILE = process.argv[2],
  PORT = +(process.argv[3] || 3150);
const CONNS = process.env.C || "6",
  PIPE = process.env.P || "1";

const server = await new Promise((res) => {
  const p = spawn("node", [FILE], { env: { ...process.env, PORT: String(PORT) } });
  p.stdout.on("data", (d) => {
    if (String(d).includes("READY")) res(p);
  });
});

const runClients = (k) =>
  Promise.all(
    Array.from(
      { length: k },
      () =>
        new Promise((res) => {
          const c = spawn("node", ["client.mjs"], {
            env: { ...process.env, PORT: String(PORT), C: CONNS, P: PIPE },
          });
          let out = "";
          c.stdout.on("data", (d) => {
            out += d;
          });
          c.on("exit", () => res(JSON.parse(out.trim()).rps));
        }),
    ),
  );

for (const k of [1, 2, 3]) {
  const rps = await runClients(k);
  const total = rps.reduce((a, b) => a + b, 0);
  console.log(
    `${FILE}  clients=${k} (C=${CONNS} each)  total ${total.toFixed(0)} rps  [${rps.map((r) => r.toFixed(0)).join(", ")}]`,
  );
}
server.kill();
