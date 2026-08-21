/**
 * Express `res` compatibility (Phase 6).
 *
 * The Session 5 process ruling named four traps in advance, and each has its
 * own group below: CRLF in `redirect`/`location`/`set`, cookie attribute
 * serialization, `Content-Disposition` filename encoding (covered in
 * `test/http/content-disposition.test.ts`), and the `send` content-type
 * inference matrix.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { describe, test } from "node:test";
import request from "supertest";
import {
  appendValue,
  encodeUrl,
  formatLinks,
  inferSendType,
  varyValue,
  withCharset,
} from "../../lib/compat/response.js";
import { serializeCookie } from "../../lib/cookies/serialize.js";
import { sign, unsign } from "../../lib/cookies/sign.js";
import zonix from "../../lib/index.js";
import { makeApp, start } from "../helpers/make-app.js";

// --- send inference matrix ---------------------------------------------------

describe("res.send: content-type inference", () => {
  test("a string becomes text/html", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.send("<p>hi</p>"));

    const res = await request(app.server).get("/s").expect(200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(res.text, "<p>hi</p>");
  });

  test("an existing content-type is honoured", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.type("txt").send("plain"));

    const res = await request(app.server).get("/s").expect(200);
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
  });

  test("a Buffer becomes application/octet-stream", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.send(Buffer.from("binary")));

    const res = await request(app.server).get("/s").buffer(true).expect(200);
    assert.equal(res.headers["content-type"], "application/octet-stream");
    assert.equal(Buffer.from(res.body).toString("utf8"), "binary");
  });

  test("an object delegates to json", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.send({ a: 1 }));

    const res = await request(app.server).get("/s").expect(200);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(res.body, { a: 1 });
  });

  test("an array delegates to json", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.send([1, 2]));

    await request(app.server).get("/s").expect(200, [1, 2]);
  });

  test("null delegates to json", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.send(null));

    const res = await request(app.server).get("/s").expect(200);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(res.text, "null");
  });

  test("a boolean delegates to json", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.send(true));

    await request(app.server).get("/s").expect(200, "true");
  });

  test("Content-Length is byte-exact for multi-byte strings", async () => {
    const app = makeApp();
    const payload = "héllo ☃";
    app.get("/s", (_req, res) => res.send(payload));

    const res = await request(app.server).get("/s").expect(200);
    assert.equal(res.headers["content-length"], String(Buffer.byteLength(payload, "utf8")));
  });

  test("a number THROWS, pointing at sendStatus (decision 13)", () => {
    // Express sends the body "404" here, which is almost never the intent.
    assert.throws(
      () => inferSendType(404, false, inferSendType),
      /sendStatus\(404\)/,
      "res.send(404) must not silently send a body",
    );
  });

  test("a 204 strips the entity headers and the body", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.status(204).send("ignored"));

    const res = await request(app.server).get("/s").expect(204);
    assert.equal(res.headers["content-type"], undefined);
    assert.equal(res.headers["content-length"], undefined);
    assert.equal(res.text, "");
  });

  test("send with no argument ends the response", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.send());

    await request(app.server).get("/s").expect(200);
  });

  test("HEAD sends the headers but no body", async () => {
    const app = makeApp();
    app.head("/s", (_req, res) => res.send("body text"));

    const res = await request(app.server).head("/s").expect(200);
    assert.equal(res.headers["content-length"], String("body text".length));
    assert.equal(res.text, undefined);
  });
});

describe("res.sendStatus", () => {
  test("sends the standard reason phrase as the body", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.sendStatus(404));

    const res = await request(app.server).get("/s").expect(404);
    assert.equal(res.text, "Not Found");
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
  });

  test("falls back to the number for an unknown code", async () => {
    const app = makeApp();
    app.get("/s", (_req, res) => res.sendStatus(499));

    const res = await request(app.server).get("/s").expect(499);
    assert.equal(res.text, "499");
  });
});

// --- headers -----------------------------------------------------------------

describe("res.set / get / append / type", () => {
  test("sets and reads a header", async () => {
    const app = makeApp();
    app.get("/h", (_req, res) => {
      res.set("X-Custom", "value");
      res.json({ read: res.get("X-Custom") });
    });

    const res = await request(app.server).get("/h").expect(200, { read: "value" });
    assert.equal(res.headers["x-custom"], "value");
  });

  test("accepts an object form", async () => {
    const app = makeApp();
    app.get("/h", (_req, res) => {
      res.set({ "X-One": "1", "X-Two": "2" }).json({});
    });

    const res = await request(app.server).get("/h").expect(200);
    assert.equal(res.headers["x-one"], "1");
    assert.equal(res.headers["x-two"], "2");
  });

  test("adds a charset to a content-type that wants one", () => {
    assert.equal(withCharset("text/html"), "text/html; charset=utf-8");
    assert.equal(withCharset("application/json"), "application/json; charset=utf-8");
    // Express's rule is text/* plus application/javascript|json only, so a
    // vendor +json type gets NO charset. Matching that exactly matters more
    // than being arguably more correct than Express.
    assert.equal(withCharset("application/vnd.api+json"), "application/vnd.api+json");
  });

  test("leaves an existing charset and binary types alone", () => {
    assert.equal(withCharset("text/html; charset=iso-8859-1"), "text/html; charset=iso-8859-1");
    assert.equal(withCharset("image/png"), "image/png");
  });

  test("append builds an array from repeated values", () => {
    assert.deepEqual(appendValue(undefined, "a"), "a");
    assert.deepEqual(appendValue("a", "b"), ["a", "b"]);
    assert.deepEqual(appendValue(["a"], "b"), ["a", "b"]);
    assert.deepEqual(appendValue("a", ["b", "c"]), ["a", "b", "c"]);
  });

  test("append sends repeated headers on the wire", async () => {
    const app = makeApp();
    app.get("/h", (_req, res) => {
      res.append("X-Multi", "one").append("X-Multi", "two").json({});
    });

    const server = await start(app);
    try {
      const raw = await rawGet(server.port, "/h");
      assert.match(raw, /X-Multi: one/);
      assert.match(raw, /X-Multi: two/);
    } finally {
      await server.close();
    }
  });

  test("type accepts an extension, a dotted extension, or a full type", async () => {
    const app = makeApp();
    app.get("/a", (_req, res) => res.type("html").send("x"));
    app.get("/b", (_req, res) => res.type(".png").send(Buffer.from("x")));
    app.get("/c", (_req, res) => res.type("application/pdf").send(Buffer.from("x")));

    assert.equal(
      (await request(app.server).get("/a")).headers["content-type"],
      "text/html; charset=utf-8",
    );
    assert.equal((await request(app.server).get("/b")).headers["content-type"], "image/png");
    assert.equal((await request(app.server).get("/c")).headers["content-type"], "application/pdf");
  });

  test("an unknown type throws instead of writing 'false'", async () => {
    const app = makeApp();
    app.get("/t", (_req, res) => res.type("nonsense").send("x"));
    app.handleErr((_err, _req, res) => res.status(500).json({ handled: true }));

    await request(app.server).get("/t").expect(500, { handled: true });
  });
});

describe("res.vary", () => {
  test("appends and deduplicates case-insensitively", () => {
    assert.equal(varyValue(undefined, ["Accept"]), "Accept");
    assert.equal(varyValue("Accept", ["Accept-Encoding"]), "Accept, Accept-Encoding");
    assert.equal(varyValue("Accept", ["accept"]), "Accept");
  });

  test("* absorbs everything", () => {
    assert.equal(varyValue("*", ["Accept"]), "*");
    assert.equal(varyValue("Accept", ["*"]), "*");
  });

  test("works over the wire", async () => {
    const app = makeApp();
    app.get("/v", (_req, res) => {
      res.vary("Accept").vary(["Accept-Encoding", "Accept"]).json({});
    });

    const res = await request(app.server).get("/v").expect(200);
    assert.equal(res.headers["vary"], "Accept, Accept-Encoding");
  });
});

describe("res.links", () => {
  test("formats relations and appends to an existing Link", () => {
    assert.equal(
      formatLinks(undefined, { next: "http://a/2", last: "http://a/9" }),
      '<http://a/2>; rel="next", <http://a/9>; rel="last"',
    );
    assert.equal(
      formatLinks('<http://a/1>; rel="first"', { next: "http://a/2" }),
      '<http://a/1>; rel="first", <http://a/2>; rel="next"',
    );
  });
});

// --- trap: CRLF injection ----------------------------------------------------

describe("trap: CRLF injection", () => {
  test("res.set refuses a value containing CR or LF", async () => {
    const app = makeApp();
    app.get("/x", (_req, res) => res.set("X-Evil", "a\r\nX-Injected: yes").json({}));
    app.handleErr((err, _req, res) => res.status(500).json({ message: err.message }));

    const res = await request(app.server).get("/x").expect(500);
    assert.match(String(res.body.message), /CR, LF or NUL/);
    assert.equal(res.headers["x-injected"], undefined);
  });

  test("res.location percent-encodes CRLF instead of splitting the response", async () => {
    const app = makeApp();
    app.get("/r", (_req, res) => res.redirect("/next\r\nX-Injected: yes"));

    const server = await start(app);
    try {
      const raw = await rawGet(server.port, "/r");
      // The header VALUE may contain the text "X-Injected" once it is
      // percent-encoded — what must not exist is a real header line, i.e. the
      // name preceded by an actual CRLF.
      assert.ok(!/\r\nX-Injected:/i.test(raw), raw);
      assert.match(raw, /Location: \/next%0D%0AX-Injected:%20yes/i);
    } finally {
      await server.close();
    }
  });

  test("encodeUrl leaves an existing escape alone", () => {
    assert.equal(encodeUrl("/a%20b"), "/a%20b");
    assert.equal(encodeUrl("/a b"), "/a%20b");
    assert.equal(encodeUrl("/a\r\nb"), "/a%0D%0Ab");
  });

  test("res.location('back') uses the Referer, or / when absent", async () => {
    const app = makeApp();
    app.get("/b", (_req, res) => {
      res.location("back");
      res.json({ location: res.get("Location") });
    });

    await request(app.server)
      .get("/b")
      .set("Referer", "http://origin.test/page")
      .expect(200, { location: "http://origin.test/page" });
    await request(app.server).get("/b").expect(200, { location: "/" });
  });
});

// --- trap: cookies -----------------------------------------------------------

describe("trap: cookie serialization", () => {
  test("emits attributes in the canonical order", () => {
    const header = serializeCookie("sid", "abc", {
      maxAge: 60,
      domain: "example.com",
      path: "/app",
      expires: new Date(Date.UTC(2030, 0, 1)),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    assert.equal(
      header,
      "sid=abc; Max-Age=60; Domain=example.com; Path=/app; " +
        "Expires=Tue, 01 Jan 2030 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
    );
  });

  test("a semicolon in the value cannot inject an attribute", () => {
    const header = serializeCookie("sid", "a; HttpOnly");
    assert.equal(header, "sid=a%3B%20HttpOnly");
    assert.equal(header.split(";").length, 1, "no extra attributes");
  });

  test("CRLF in the value cannot inject a header", () => {
    const header = serializeCookie("sid", "a\r\nSet-Cookie: evil=1");
    assert.ok(!header.includes("\r"), header);
    assert.ok(!header.includes("\n"), header);
  });

  test("a custom encoder still cannot smuggle a semicolon through", () => {
    // The encoded value is validated, so an identity encoder is caught.
    assert.throws(
      () => serializeCookie("sid", "a; HttpOnly", { encode: (v) => v }),
      /invalid cookie value/,
    );
  });

  test("a polluted Object.prototype.encode cannot hijack value encoding", () => {
    // Express reads opt.encode with a plain lookup, which walks the prototype
    // chain — so pollution would replace the escaping that stops attribute
    // injection. We read it as an own property.
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["encode"] = (v: string) => v; // identity: would let ";" through
    try {
      assert.equal(serializeCookie("sid", "a; HttpOnly"), "sid=a%3B%20HttpOnly");
    } finally {
      delete proto["encode"];
    }
  });

  test("a value the encoder cannot handle fails as a framework error", () => {
    // encodeURIComponent throws URIError on a lone surrogate; without a guard
    // that surfaces as a bare "URI malformed" with no mention of cookies.
    assert.throws(() => serializeCookie("sid", "\ud800"), /could not encode the value/);
  });

  test("an invalid name is rejected", () => {
    assert.throws(() => serializeCookie("bad name", "v"), /invalid cookie name/);
    assert.throws(() => serializeCookie("bad;name", "v"), /invalid cookie name/);
  });

  test("path and domain are validated, not interpolated blindly", () => {
    assert.throws(() => serializeCookie("a", "b", { path: "/x;HttpOnly" }), /invalid path/);
    assert.throws(() => serializeCookie("a", "b", { path: "/x\r\nX: y" }), /invalid path/);
    assert.throws(() => serializeCookie("a", "b", { domain: "evil;domain" }), /invalid domain/);
  });

  test("sameSite accepts the documented forms and rejects others", () => {
    assert.match(serializeCookie("a", "b", { sameSite: true }), /SameSite=Strict$/);
    assert.match(serializeCookie("a", "b", { sameSite: "none" }), /SameSite=None$/);
    assert.throws(
      () => serializeCookie("a", "b", { sameSite: "sometimes" as never }),
      /invalid sameSite/,
    );
  });
});

describe("res.cookie / clearCookie", () => {
  test("sets a cookie with the default path", async () => {
    const app = makeApp();
    app.get("/c", (_req, res) => res.cookie("sid", "abc").json({}));

    const res = await request(app.server).get("/c").expect(200);
    assert.deepEqual(res.headers["set-cookie"], ["sid=abc; Path=/"]);
  });

  test("maxAge is milliseconds in, seconds out, and also sets Expires", async () => {
    const app = makeApp();
    app.get("/c", (_req, res) => res.cookie("sid", "abc", { maxAge: 60_000 }).json({}));

    const res = await request(app.server).get("/c").expect(200);
    const header = (res.headers["set-cookie"] as unknown as string[])[0] as string;
    assert.match(header, /Max-Age=60(;|$)/);
    assert.match(header, /Expires=/);
  });

  test("an object value travels as the j: JSON form", async () => {
    const app = makeApp();
    app.get("/c", (_req, res) => res.cookie("pref", { theme: "dark" }).json({}));

    const res = await request(app.server).get("/c").expect(200);
    const header = (res.headers["set-cookie"] as unknown as string[])[0] as string;
    assert.match(header, /^pref=j%3A%7B%22theme%22%3A%22dark%22%7D/);
  });

  test("multiple cookies each get their own header", async () => {
    const app = makeApp();
    app.get("/c", (_req, res) => res.cookie("a", "1").cookie("b", "2").json({}));

    const res = await request(app.server).get("/c").expect(200);
    assert.equal((res.headers["set-cookie"] as unknown as string[]).length, 2);
  });

  test("signing requires a secret", async () => {
    const app = makeApp();
    app.get("/c", (_req, res) => res.cookie("sid", "abc", { signed: true }).json({}));
    app.handleErr((err, _req, res) => res.status(500).json({ message: err.message }));

    const res = await request(app.server).get("/c").expect(500);
    assert.match(String(res.body.message), /cookieSecret/);
  });

  test("a signed cookie carries the s: prefix and verifies", async () => {
    const app = zonix({ dev: false, cookieSecret: "top-secret" });
    app.get("/c", (_req, res) => res.cookie("sid", "abc", { signed: true }).json({}));

    const res = await request(app.server).get("/c").expect(200);
    const header = (res.headers["set-cookie"] as unknown as string[])[0] as string;
    const value = decodeURIComponent((header.split("=")[1] as string).split(";")[0] as string);
    assert.ok(value.startsWith("s:"), value);
    assert.equal(unsign(value.slice(2), "top-secret"), "abc");
  });

  test("clearCookie expires the cookie and cannot be turned into a renewal", async () => {
    const app = makeApp();
    // Express 4 lets a caller's maxAge override the epoch expiry, so the cookie
    // is renewed rather than cleared. Ours forces the expiry.
    app.get("/c", (_req, res) => res.clearCookie("sid", { maxAge: 100_000 }).json({}));

    const res = await request(app.server).get("/c").expect(200);
    const header = (res.headers["set-cookie"] as unknown as string[])[0] as string;
    assert.match(header, /Expires=Thu, 01 Jan 1970/);
    assert.ok(!/Max-Age=1\d\d/.test(header), header);
  });

  test("clearCookie keeps a matching path so the browser actually clears it", async () => {
    const app = makeApp();
    app.get("/c", (_req, res) => res.clearCookie("sid", { path: "/admin" }).json({}));

    const res = await request(app.server).get("/c").expect(200);
    assert.match((res.headers["set-cookie"] as unknown as string[])[0] as string, /Path=\/admin/);
  });
});

describe("cookie signing", () => {
  test("round-trips", () => {
    const signed = sign("hello", "secret");
    assert.equal(unsign(signed, "secret"), "hello");
  });

  test("rejects a tampered value", () => {
    const signed = sign("hello", "secret");
    assert.equal(unsign(signed.replace("hello", "hell0"), "secret"), false);
  });

  test("rejects the wrong secret", () => {
    assert.equal(unsign(sign("hello", "secret"), "other"), false);
  });

  test("uses standard base64 without padding", () => {
    const signature = sign("hello", "secret").split(".")[1] as string;
    assert.equal(signature.length, 43, "SHA-256 base64 without padding");
    assert.ok(!signature.includes("="), signature);
    assert.ok(!/[-_]/.test(signature), "base64url would break interop");
  });

  test("a value containing dots still verifies", () => {
    assert.equal(unsign(sign("a.b.c", "k"), "k"), "a.b.c");
  });

  test("malformed input is rejected rather than thrown", () => {
    assert.equal(unsign("no-separator", "k"), false);
    assert.equal(unsign("", "k"), false);
  });
});

describe("res.locals", () => {
  test("is per-response, null-prototype, and created on first touch", async () => {
    const app = makeApp();
    app.use((_req, res, next) => {
      res.locals["user"] = "ada";
      next();
    });
    app.get("/l", (_req, res) => {
      res.json({
        user: res.locals["user"],
        polluted: ({} as Record<string, unknown>)["polluted"] ?? null,
        proto: Object.getPrototypeOf(res.locals),
      });
    });

    await request(app.server).get("/l").expect(200, { user: "ada", polluted: null, proto: null });
  });

  test("does not leak between responses", async () => {
    const app = makeApp();
    app.get("/l", (_req, res) => {
      const seen = res.locals["seen"] ?? null;
      res.locals["seen"] = true;
      res.json({ seen });
    });

    await request(app.server).get("/l").expect(200, { seen: null });
    await request(app.server).get("/l").expect(200, { seen: null });
  });
});

/** Raw request so repeated headers and the status line can be inspected. */
function rawGet(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (data += chunk));
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}
