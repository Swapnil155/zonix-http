// T-1 baseline: the strongest raw node:http. Prebuilt body buffers, writeHead
// per request — deliberately harsher than any framework, because D7's bar is
// measured against the best node:http can possibly do, not a strawman.
//
// Two brackets: GET / completes synchronously; GET /echo completes in a
// setImmediate callback (the same mechanism in all four servers).
import http from "node:http";

const HELLO = Buffer.from(JSON.stringify({ hello: "world" }));
const ECHO = Buffer.from(JSON.stringify({ path: "/echo" }));
const HELLO_HEAD = {
  "content-type": "application/json; charset=utf-8",
  "content-length": HELLO.length,
};
const ECHO_HEAD = {
  "content-type": "application/json; charset=utf-8",
  "content-length": ECHO.length,
};

const srv = http.createServer((req, res) => {
  if (req.url === "/echo") {
    setImmediate(() => {
      res.writeHead(200, ECHO_HEAD);
      res.end(ECHO);
    });
    return;
  }
  res.writeHead(200, HELLO_HEAD);
  res.end(HELLO);
});
srv.on("connection", (s) => s.setNoDelay(true));
srv.listen(Number(process.env.PORT || 3111), () => console.log("READY"));
