// HTTPS / TLS. zonix-http serves HTTP and does not reimplement TLS — Node and
// OpenSSL own it. There are two ways to put it behind TLS.
import zonix, { ZonixRequest, ZonixResponse } from "../dist/index.js";
import https from "node:https";

// (1) PREFERRED — terminate TLS at a reverse proxy (nginx, Caddy, ALB) and run
// zonix over plain HTTP behind it. The proxy sends `X-Forwarded-Proto: https`;
// set trustProxy so req.protocol / req.secure (and therefore `secure` cookies)
// reflect the real client scheme. All of the app's settings apply normally.
export function makeProxyApp() {
  const app = zonix({ trustProxy: 1 });
  app.get("/whoami", (req, res) => {
    res.json({ protocol: req.protocol, secure: req.secure, ip: req.ip });
  });
  return app; // deploy behind the proxy: app.listen(8080)
}

// (2) DIRECT in-process TLS — hand Node's https server the app's request
// listener together with the two request/response subclasses zonix installs.
// NOTE: settings compiled onto the app's own http.Server (cookieSecret,
// trustProxy, query parser, etag) do NOT transfer to a foreign server, so use
// the reverse-proxy path above for anything relying on them.
export function makeHttpsServer(key, cert) {
  const app = zonix();
  app.get("/whoami", (req, res) => res.json({ protocol: req.protocol, secure: req.secure }));

  const listener = app.server.listeners("request")[0];
  return https.createServer(
    { key, cert, IncomingMessage: ZonixRequest, ServerResponse: ZonixResponse },
    listener,
  ); // server.listen(443)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  makeProxyApp().listen(8080, () => console.log("proxy-mode app on http://localhost:8080"));
}
