// Baseline: the strongest hello-world raw node:http can do. No framework.
import http from "node:http";
const BODY = Buffer.from(JSON.stringify({ hello: "world" }));
const srv = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json", "content-length": BODY.length });
  res.end(BODY);
});
srv.on("connection", (s) => s.setNoDelay(true));
srv.listen(Number(process.env.PORT || 3101), () => console.log("READY"));
