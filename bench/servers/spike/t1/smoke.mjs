// Baseline smoke: every server answers both brackets with the correct body.
// Part of the committed correctness set — a baseline serving the wrong bytes
// would corrupt every ratio silently.
import { spawn } from "node:child_process";

const SERVERS = [
  ["raw.mjs", 3111],
  ["zonix.mjs", 3112],
  ["fastify.mjs", 3113],
  ["turbo-t1.mjs", 3114],
];

let failed = 0;
for (const [file, port] of SERVERS) {
  const proc = await new Promise((res) => {
    const p = spawn("node", [file], { env: { ...process.env, PORT: String(port) } });
    p.stdout.on("data", (d) => {
      if (String(d).includes("READY")) res(p);
    });
  });
  try {
    const hello = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    const echo = await (await fetch(`http://127.0.0.1:${port}/echo`)).text();
    const okHello = hello === '{"hello":"world"}';
    const okEcho = echo === '{"path":"/echo"}';
    console.log(
      `${file.padEnd(14)} hello=${okHello ? "OK" : JSON.stringify(hello)}  echo=${okEcho ? "OK" : JSON.stringify(echo)}`,
    );
    if (!okHello || !okEcho) failed++;
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 150));
  }
}
process.exit(failed === 0 ? 0 : 1);
