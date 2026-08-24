// WebSockets / realtime with socket.io attached to the app's HTTP server.
//
// zonix-http is an HTTP core and has no WebSocket/upgrade handling. socket.io
// (or lower-level `ws`) attaches to the underlying http.Server, which a zonix
// app already owns and exposes as `app.server`. Reach for `ws` if you want the
// lower-level socket without the socket.io protocol.
import zonix from "../dist/index.js";
import { Server } from "socket.io";

export function makeServer() {
  const app = zonix();
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // socket.io attaches its own `upgrade`/`request` listeners to app.server.
  const io = new Server(app.server, { cors: { origin: false } });

  io.on("connection", (socket) => {
    // Basic realtime: broadcast a chat line to everyone else.
    socket.on("chat", (msg) => socket.broadcast.emit("chat", msg));

    // WebRTC signaling: the server only RELAYS the SDP offer/answer and ICE
    // candidates between peers in a room. The actual audio/video/data flows
    // peer-to-peer over STUN/TURN (run your own coturn) — it never touches
    // this server.
    socket.on("join", (room) => {
      socket.join(room);
      socket.to(room).emit("peer-joined", socket.id);
    });
    socket.on("offer", ({ room, sdp }) => socket.to(room).emit("offer", { from: socket.id, sdp }));
    socket.on("answer", ({ room, sdp }) =>
      socket.to(room).emit("answer", { from: socket.id, sdp }),
    );
    socket.on("ice-candidate", ({ room, candidate }) =>
      socket.to(room).emit("ice-candidate", { from: socket.id, candidate }),
    );
  });

  // app.listen() starts the very server socket.io is bound to.
  return { app, io };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = makeServer();
  app.listen(3000, () => console.log("realtime demo on http://localhost:3000"));
}
