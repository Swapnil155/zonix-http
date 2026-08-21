/**
 * Express `req` compatibility (Phase 6).
 *
 * Two layers. The pure functions in `lib/compat/request.ts` and
 * `lib/http/proxy.ts` are unit-tested against a vector table — the trust-proxy
 * matrix alone is dozens of combinations, and standing up a server per
 * combination would be slower and no more convincing. The accessors on
 * `ZonixRequest` are then exercised over a real HTTP connection, so the wiring
 * (settings lookup, laziness, socket access) is covered end to end.
 *
 * The awkward cases here are deliberate: bracketed IPv6 with a port, IPv4-mapped
 * IPv6, `X-Forwarded-For` ordering, `is()` returning the matched string rather
 * than `true`, and `referer`/`referrer` aliasing.
 */
import assert from "node:assert/strict";
import type { IncomingHttpHeaders } from "node:http";
import { describe, test } from "node:test";
import request from "supertest";
import {
  getHeader,
  getHost,
  getHostname,
  getIp,
  getIps,
  getProtocol,
  getSubdomains,
  isXhr,
  typeIs,
} from "../../lib/compat/request.js";
import { compileTrust, parseForwarded, parseIp } from "../../lib/http/proxy.js";
import zonix from "../../lib/index.js";
import { makeApp } from "../helpers/make-app.js";

const h = (headers: Record<string, string | string[]>): IncomingHttpHeaders =>
  headers as IncomingHttpHeaders;
const NO_TRUST = compileTrust(false);
const ALL_TRUST = compileTrust(true);

describe("req.get / req.header", () => {
  test("is case-insensitive", () => {
    const headers = h({ "content-type": "application/json" });
    assert.equal(getHeader(headers, "Content-Type"), "application/json");
    assert.equal(getHeader(headers, "CONTENT-TYPE"), "application/json");
    assert.equal(getHeader(headers, "content-type"), "application/json");
  });

  test("returns undefined for a missing header", () => {
    assert.equal(getHeader(h({}), "x-nope"), undefined);
  });

  test("referer and referrer alias each other, in both directions", () => {
    assert.equal(getHeader(h({ referer: "http://a/" }), "referrer"), "http://a/");
    assert.equal(getHeader(h({ referrer: "http://b/" }), "referer"), "http://b/");
    assert.equal(getHeader(h({ referer: "http://a/" }), "Referrer"), "http://a/");
  });

  test("referrer wins when both are present", () => {
    const headers = h({ referer: "http://a/", referrer: "http://b/" });
    assert.equal(getHeader(headers, "referer"), "http://b/");
  });

  test("a present-but-empty referer yields the empty string, not undefined", () => {
    // The expression is `referrer || referer`, so an empty referrer falls
    // through to referer; an empty referer with no referrer yields "".
    assert.equal(getHeader(h({ referer: "" }), "referer"), "");
  });

  test("set-cookie comes back as an array", () => {
    const headers = h({ "set-cookie": ["a=1", "b=2"] });
    assert.deepEqual(getHeader(headers, "set-cookie"), ["a=1", "b=2"]);
  });

  test("__proto__ and constructor cannot escape into the prototype chain", () => {
    // Without an own-property guard these return Object and Function.
    assert.equal(getHeader(h({}), "__proto__"), undefined);
    assert.equal(getHeader(h({}), "constructor"), undefined);
    assert.equal(getHeader(h({}), "toString"), undefined);
  });

  test("a non-string name throws", () => {
    assert.throws(() => getHeader(h({}), undefined), /header name/);
    assert.throws(() => getHeader(h({}), 42), /header name/);
  });
});

describe("req.xhr", () => {
  test("matches XMLHttpRequest case-insensitively", () => {
    assert.equal(isXhr(h({ "x-requested-with": "XMLHttpRequest" })), true);
    assert.equal(isXhr(h({ "x-requested-with": "xmlhttprequest" })), true);
  });

  test("is false for anything else, including absent", () => {
    assert.equal(isXhr(h({})), false);
    assert.equal(isXhr(h({ "x-requested-with": "" })), false);
    assert.equal(isXhr(h({ "x-requested-with": "fetch" })), false);
  });
});

describe("req.protocol / req.secure", () => {
  test("plain connections are http", () => {
    assert.equal(getProtocol(h({}), false, "1.2.3.4", NO_TRUST), "http");
  });

  test("an encrypted socket is https", () => {
    assert.equal(getProtocol(h({}), true, "1.2.3.4", NO_TRUST), "https");
  });

  test("X-Forwarded-Proto is ignored when the peer is not trusted", () => {
    const headers = h({ "x-forwarded-proto": "https" });
    assert.equal(getProtocol(headers, false, "1.2.3.4", NO_TRUST), "http");
  });

  test("X-Forwarded-Proto is honoured when the peer is trusted", () => {
    const headers = h({ "x-forwarded-proto": "https" });
    assert.equal(getProtocol(headers, false, "1.2.3.4", ALL_TRUST), "https");
  });

  test("the leftmost value of a forwarded list wins", () => {
    const headers = h({ "x-forwarded-proto": "https, http" });
    assert.equal(getProtocol(headers, false, "1.2.3.4", ALL_TRUST), "https");
  });

  test("the trust function is consulted exactly once", () => {
    let calls = 0;
    const counting = (): boolean => {
      calls += 1;
      return true;
    };
    getProtocol(h({ "x-forwarded-proto": "https" }), false, "1.2.3.4", counting);
    assert.equal(calls, 1);
  });
});

describe("req.hostname", () => {
  test("strips the port", () => {
    assert.equal(getHostname(h({ host: "example.com:3000" }), "1.2.3.4", NO_TRUST), "example.com");
  });

  test("keeps a bracketed IPv6 literal intact, with and without a port", () => {
    // split(":")[0] would return "[" here.
    assert.equal(getHostname(h({ host: "[::1]:3000" }), "1.2.3.4", NO_TRUST), "[::1]");
    assert.equal(getHostname(h({ host: "[::1]" }), "1.2.3.4", NO_TRUST), "[::1]");
    assert.equal(
      getHostname(h({ host: "[::ffff:127.0.0.1]:80" }), "1.2.3.4", NO_TRUST),
      "[::ffff:127.0.0.1]",
    );
  });

  test("returns undefined when Host is absent or empty", () => {
    assert.equal(getHostname(h({}), "1.2.3.4", NO_TRUST), undefined);
    assert.equal(getHostname(h({ host: "" }), "1.2.3.4", NO_TRUST), undefined);
  });

  test("X-Forwarded-Host is ignored when the peer is not trusted", () => {
    const headers = h({ host: "real.example", "x-forwarded-host": "spoofed.example" });
    assert.equal(getHostname(headers, "1.2.3.4", NO_TRUST), "real.example");
  });

  test("X-Forwarded-Host wins when the peer is trusted, first entry only", () => {
    const headers = h({ host: "real.example", "x-forwarded-host": "a.example, b.example" });
    assert.equal(getHostname(headers, "1.2.3.4", ALL_TRUST), "a.example");
  });

  test("the trust function is not consulted at all when X-Forwarded-Host is absent", () => {
    let calls = 0;
    const counting = (): boolean => {
      calls += 1;
      return true;
    };
    getHostname(h({ host: "example.com" }), "1.2.3.4", counting);
    assert.equal(calls, 0, "Express short-circuits before consulting trust");
  });
});

describe("req.host (D6: Express 5 semantics — port included)", () => {
  test("keeps the port, where hostname strips it", () => {
    const headers = h({ host: "example.com:3000" });
    assert.equal(getHost(headers, "1.2.3.4", NO_TRUST), "example.com:3000");
    assert.equal(getHostname(headers, "1.2.3.4", NO_TRUST), "example.com");
  });

  test("is identical to hostname when there is no port", () => {
    const headers = h({ host: "example.com" });
    assert.equal(getHost(headers, "1.2.3.4", NO_TRUST), "example.com");
    assert.equal(getHostname(headers, "1.2.3.4", NO_TRUST), "example.com");
  });

  test("keeps a bracketed IPv6 literal and its port intact", () => {
    const headers = h({ host: "[::1]:3000" });
    assert.equal(getHost(headers, "1.2.3.4", NO_TRUST), "[::1]:3000");
    assert.equal(getHostname(headers, "1.2.3.4", NO_TRUST), "[::1]");
  });

  test("an IPv6 literal with no port is unchanged by either", () => {
    const headers = h({ host: "[::ffff:127.0.0.1]" });
    assert.equal(getHost(headers, "1.2.3.4", NO_TRUST), "[::ffff:127.0.0.1]");
    assert.equal(getHostname(headers, "1.2.3.4", NO_TRUST), "[::ffff:127.0.0.1]");
  });

  test("honours trust proxy exactly as hostname does", () => {
    const headers = h({ host: "real.example:80", "x-forwarded-host": "fwd.example:443" });
    assert.equal(getHost(headers, "1.2.3.4", NO_TRUST), "real.example:80");
    assert.equal(getHost(headers, "1.2.3.4", ALL_TRUST), "fwd.example:443");
  });

  test("is undefined when Host is absent", () => {
    assert.equal(getHost(h({}), "1.2.3.4", NO_TRUST), undefined);
  });
});

describe("req.subdomains", () => {
  test("uses an offset of 2 by default and returns outermost last", () => {
    assert.deepEqual(getSubdomains("a.b.example.com", 2), ["b", "a"]);
  });

  test("is empty for a bare domain", () => {
    assert.deepEqual(getSubdomains("example.com", 2), []);
  });

  test("honours a custom offset", () => {
    assert.deepEqual(getSubdomains("a.b.example.com", 3), ["a"]);
    assert.deepEqual(getSubdomains("a.b.example.com", 0), ["com", "example", "b", "a"]);
  });

  test("an IP host has no subdomains", () => {
    assert.deepEqual(getSubdomains("192.168.1.1", 2), []);
    assert.deepEqual(getSubdomains("[::1]", 2), []);
    assert.deepEqual(getSubdomains("::1", 2), []);
  });

  test("an absent hostname yields an empty list", () => {
    assert.deepEqual(getSubdomains(undefined, 2), []);
  });
});

describe("X-Forwarded-For tokenizing", () => {
  test("reads right to left", () => {
    assert.deepEqual(parseForwarded("1.1.1.1, 2.2.2.2, 3.3.3.3"), [
      "3.3.3.3",
      "2.2.2.2",
      "1.1.1.1",
    ]);
  });

  test("drops empty and space-only tokens", () => {
    assert.deepEqual(parseForwarded(",,,"), []);
    assert.deepEqual(parseForwarded("  ,  "), []);
    assert.deepEqual(parseForwarded("1.1.1.1,,2.2.2.2"), ["2.2.2.2", "1.1.1.1"]);
  });

  test("a tab-only token survives, because only 0x20 is padding", () => {
    assert.deepEqual(parseForwarded("1.1.1.1,\t,2.2.2.2"), ["2.2.2.2", "\t", "1.1.1.1"]);
  });
});

describe("trust proxy compilation", () => {
  test("off by default: nothing is trusted", () => {
    assert.equal(compileTrust(undefined)("127.0.0.1", 0), false);
    assert.equal(compileTrust(false)("127.0.0.1", 0), false);
  });

  test("true trusts everything", () => {
    assert.equal(compileTrust(true)("8.8.8.8", 0), true);
  });

  test("a hop count trusts exactly that many nearest hops", () => {
    const trust = compileTrust(2);
    assert.equal(trust("any", 0), true);
    assert.equal(trust("any", 1), true);
    assert.equal(trust("any", 2), false);
  });

  test("the loopback preset covers IPv4 and IPv6", () => {
    const trust = compileTrust("loopback");
    assert.equal(trust("127.0.0.1", 0), true);
    assert.equal(trust("127.9.9.9", 0), true);
    assert.equal(trust("::1", 0), true);
    assert.equal(trust("8.8.8.8", 0), false);
  });

  test("uniquelocal covers the private ranges but not loopback", () => {
    const trust = compileTrust("uniquelocal");
    assert.equal(trust("10.0.0.1", 0), true);
    assert.equal(trust("172.20.0.5", 0), true);
    assert.equal(trust("172.32.0.1", 0), false, "outside 172.16/12");
    assert.equal(trust("192.168.1.1", 0), true);
    assert.equal(trust("fd00::1", 0), true);
    assert.equal(trust("127.0.0.1", 0), false, "loopback is a separate preset");
  });

  test("an explicit CIDR matches only inside the range", () => {
    const trust = compileTrust("10.0.0.0/8");
    assert.equal(trust("10.255.255.255", 0), true);
    assert.equal(trust("11.0.0.1", 0), false);
  });

  test("a comma string and an array are equivalent", () => {
    const a = compileTrust("loopback,10.0.0.0/8");
    const b = compileTrust(["loopback", "10.0.0.0/8"]);
    for (const address of ["127.0.0.1", "10.1.2.3", "8.8.8.8"]) {
      assert.equal(a(address, 0), b(address, 0), address);
    }
  });

  test("an IPv4-mapped IPv6 address matches an IPv4 range", () => {
    const trust = compileTrust("loopback");
    assert.equal(trust("::ffff:127.0.0.1", 0), true);
  });

  test("a zone index does not break matching", () => {
    assert.equal(compileTrust("fe80::/10")("fe80::1%eth0", 0), true);
  });

  test("a predicate is used as given", () => {
    const trust = compileTrust((address) => address === "9.9.9.9");
    assert.equal(trust("9.9.9.9", 0), true);
    assert.equal(trust("1.1.1.1", 0), false);
  });

  test("malformed settings throw at setup", () => {
    assert.throws(() => compileTrust("not-an-ip"), /not an IP address or CIDR/);
    assert.throws(() => compileTrust("10.0.0.0/64"), /prefix length exceeds/);
    assert.throws(() => compileTrust(-1), /non-negative integer/);
  });

  test("an unparseable address is never trusted", () => {
    assert.equal(compileTrust("loopback")("garbage", 0), false);
    assert.equal(compileTrust("loopback")(undefined, 0), false);
  });
});

describe("parseIp", () => {
  test("accepts the forms that matter and rejects junk", () => {
    assert.ok(parseIp("127.0.0.1"));
    assert.ok(parseIp("::1"));
    assert.ok(parseIp("::ffff:127.0.0.1"));
    assert.ok(parseIp("fe80::1%eth0"));
    assert.equal(parseIp("256.0.0.1"), undefined);
    assert.equal(parseIp("1.2.3"), undefined);
    assert.equal(parseIp("not-an-ip"), undefined);
    assert.equal(parseIp(""), undefined);
  });
});

describe("req.ip / req.ips", () => {
  const xff = (value: string) => h({ "x-forwarded-for": value });

  test("with trust off, ip is the socket address and ips is empty", () => {
    const headers = xff("1.1.1.1, 2.2.2.2");
    assert.equal(getIp(headers, "10.0.0.1", NO_TRUST), "10.0.0.1");
    assert.deepEqual(getIps(headers, "10.0.0.1", NO_TRUST), []);
  });

  test("a spoofed X-Forwarded-For cannot change req.ip when trust is off", () => {
    assert.equal(getIp(xff("evil.spoof"), "203.0.113.5", NO_TRUST), "203.0.113.5");
  });

  test("with trust on, ip is the client-most address", () => {
    const headers = xff("1.1.1.1, 2.2.2.2");
    assert.equal(getIp(headers, "10.0.0.1", ALL_TRUST), "1.1.1.1");
  });

  test("ips is the forwarded chain client-first", () => {
    const headers = xff("1.1.1.1, 2.2.2.2, 3.3.3.3");
    assert.deepEqual(getIps(headers, "10.0.0.1", ALL_TRUST), ["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
  });

  test("a hop count stops the walk at the right place", () => {
    const headers = xff("1.1.1.1, 2.2.2.2, 3.3.3.3");
    // Trusting one hop believes only the nearest proxy, so the client address
    // is the one it reported.
    assert.equal(getIp(headers, "10.0.0.1", compileTrust(1)), "3.3.3.3");
    assert.equal(getIp(headers, "10.0.0.1", compileTrust(2)), "2.2.2.2");
  });

  test("a CIDR trust list stops at the first address outside it", () => {
    const headers = xff("1.1.1.1, 172.20.0.5");
    const trust = compileTrust(["loopback", "172.16.0.0/12"]);
    assert.equal(getIp(headers, "127.0.0.1", trust), "1.1.1.1");
    assert.deepEqual(getIps(headers, "127.0.0.1", trust), ["1.1.1.1", "172.20.0.5"]);
  });

  test("no forwarded header just yields the socket address", () => {
    assert.equal(getIp(h({}), "10.0.0.1", ALL_TRUST), "10.0.0.1");
    assert.deepEqual(getIps(h({}), "10.0.0.1", ALL_TRUST), []);
  });

  test("an empty forwarded header is harmless", () => {
    assert.equal(getIp(xff(""), "10.0.0.1", ALL_TRUST), "10.0.0.1");
    assert.deepEqual(getIps(xff(""), "10.0.0.1", ALL_TRUST), []);
  });
});

describe("req.is", () => {
  const body = (contentType: string) => h({ "content-type": contentType, "content-length": "10" });

  test("returns the matched type string, not true", () => {
    assert.equal(typeIs(body("application/json"), ["json"]), "json");
    assert.equal(typeIs(body("application/json"), ["application/json"]), "application/json");
  });

  test("returns false when nothing matches", () => {
    assert.equal(typeIs(body("text/html"), ["json"]), false);
  });

  test("returns null when the request declares no body", () => {
    assert.equal(typeIs(h({ "content-type": "application/json" }), ["json"]), null);
  });

  test("a content-length of 0 still counts as a declared body", () => {
    const headers = h({ "content-type": "application/json", "content-length": "0" });
    assert.equal(typeIs(headers, ["json"]), "json");
  });

  test("transfer-encoding counts as a body", () => {
    const headers = h({ "content-type": "application/json", "transfer-encoding": "chunked" });
    assert.equal(typeIs(headers, ["json"]), "json");
  });

  test("charset and other parameters are ignored", () => {
    assert.equal(typeIs(body("application/json; charset=utf-8"), ["json"]), "json");
  });

  test("matching is case-insensitive", () => {
    assert.equal(typeIs(body("APPLICATION/JSON"), ["json"]), "json");
    assert.equal(typeIs(body("application/json"), ["JSON"]), "JSON");
  });

  test("wildcards match", () => {
    // A wildcard pattern returns the MATCHED type, not the pattern - so the
    // caller learns what actually arrived. Verified against the real `type-is`
    // in the differential test below; the Express docs say otherwise and are
    // wrong.
    assert.equal(typeIs(body("application/json"), ["*/*"]), "application/json");
    assert.equal(typeIs(body("application/json"), ["application/*"]), "application/json");
    assert.equal(typeIs(body("application/json"), ["*/json"]), "application/json");
    assert.equal(typeIs(body("text/html"), ["application/*"]), false);
  });

  test("a +suffix matches structured syntax types", () => {
    // Same rule as wildcards: a "+suffix" pattern returns the matched type.
    assert.equal(typeIs(body("application/vnd.api+json"), ["+json"]), "application/vnd.api+json");
    assert.equal(typeIs(body("application/json"), ["+json"]), false);
  });

  test("the json shorthand does not match a vendor +json type", () => {
    // "json" expands to the concrete application/json, so it is not a suffix match.
    assert.equal(typeIs(body("application/vnd.api+json"), ["json"]), false);
  });

  test("the urlencoded and multipart shorthands work", () => {
    assert.equal(typeIs(body("application/x-www-form-urlencoded"), ["urlencoded"]), "urlencoded");
    assert.equal(typeIs(body("multipart/form-data"), ["multipart"]), "multipart");
  });

  test("the first matching type of several is returned", () => {
    assert.equal(typeIs(body("text/html"), ["json", "html"]), "html");
  });

  test("with no types given, the normalized content type comes back", () => {
    assert.equal(typeIs(body("application/json; charset=utf-8"), []), "application/json");
  });

  test("a malformed content type does not match", () => {
    assert.equal(typeIs(body("nonsense"), ["json"]), false);
    assert.equal(typeIs(body(""), ["json"]), false);
  });
});

// --- end-to-end wiring -------------------------------------------------------

describe("compat accessors over a real request", () => {
  test("get/header, xhr, protocol, secure, hostname and subdomains are wired", async () => {
    const app = makeApp();
    app.get("/probe", (req, res) => {
      res.json({
        get: req.get("x-custom") ?? null,
        header: req.header("X-CUSTOM") ?? null,
        referer: req.get("referrer") ?? null,
        xhr: req.xhr,
        protocol: req.protocol,
        secure: req.secure,
        hostname: req.hostname ?? null,
        subdomains: req.subdomains,
        originalUrl: req.originalUrl,
        baseUrl: req.baseUrl,
        path: req.path,
      });
    });

    const res = await request(app.server)
      .get("/probe?q=1")
      .set("X-Custom", "value")
      .set("Referer", "http://origin.test/")
      .set("X-Requested-With", "XMLHttpRequest")
      .set("Host", "a.b.example.com:8080")
      .expect(200);

    assert.deepEqual(res.body, {
      get: "value",
      header: "value",
      referer: "http://origin.test/",
      xhr: true,
      protocol: "http",
      secure: false,
      hostname: "a.b.example.com",
      subdomains: ["b", "a"],
      originalUrl: "/probe?q=1",
      baseUrl: "",
      path: "/probe",
    });
  });

  test("req.is works over the wire and distinguishes no-body from no-match", async () => {
    const app = makeApp();
    app.post("/is", (req, res) => {
      res.json({ json: req.is("json"), html: req.is("html"), any: req.is("*/*") });
    });
    app.get("/is", (req, res) => {
      res.json({ json: req.is("json") });
    });

    await request(app.server)
      .post("/is")
      .set("Content-Type", "application/json")
      .send("{}")
      .expect(200, { json: "json", html: false, any: "application/json" });

    // A GET with no body at all: null, not false.
    await request(app.server).get("/is").expect(200, { json: null });
  });

  test("req.host keeps the port and req.hostname strips it, over the wire", async () => {
    const app = makeApp();
    app.get("/h", (req, res) => {
      res.json({ host: req.host ?? null, hostname: req.hostname ?? null });
    });

    await request(app.server)
      .get("/h")
      .set("Host", "example.com:8080")
      .expect(200, { host: "example.com:8080", hostname: "example.com" });
  });

  test("req.is accepts varargs and a single array, like Express", async () => {
    const app = makeApp();
    app.post("/is", (req, res) => {
      res.json({ varargs: req.is("json", "html"), array: req.is(["xml", "html"]) });
    });

    await request(app.server)
      .post("/is")
      .set("Content-Type", "text/html")
      .send("<p>hi</p>")
      .expect(200, { varargs: "html", array: "html" });
  });

  test("trust proxy is off by default, so forwarded headers are ignored", async () => {
    const app = makeApp();
    app.get("/who", (req, res) => {
      res.json({ ip: req.ip ?? null, ips: req.ips, protocol: req.protocol, host: req.hostname });
    });

    const res = await request(app.server)
      .get("/who")
      .set("X-Forwarded-For", "1.2.3.4")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "spoofed.example")
      .set("Host", "real.example")
      .expect(200);

    assert.notEqual(res.body.ip, "1.2.3.4", "a spoofed XFF must not become req.ip");
    assert.deepEqual(res.body.ips, []);
    assert.equal(res.body.protocol, "http");
    assert.equal(res.body.host, "real.example");
  });

  test("with trustProxy on, forwarded headers are honoured", async () => {
    const app = zonix({ dev: false, trustProxy: true });
    app.get("/who", (req, res) => {
      res.json({ ip: req.ip ?? null, ips: req.ips, protocol: req.protocol, host: req.hostname });
    });

    const res = await request(app.server)
      .get("/who")
      .set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "forwarded.example")
      .set("Host", "real.example")
      .expect(200);

    assert.equal(res.body.ip, "1.2.3.4");
    assert.deepEqual(res.body.ips, ["1.2.3.4", "5.6.7.8"]);
    assert.equal(res.body.protocol, "https");
    assert.equal(res.body.host, "forwarded.example");
  });

  test("subdomainOffset is configurable", async () => {
    const app = zonix({ dev: false, subdomainOffset: 3 });
    app.get("/s", (req, res) => res.json(req.subdomains));

    await request(app.server).get("/s").set("Host", "a.b.example.com").expect(200, ["a"]);
  });

  test("accessors are cached, so repeated reads are stable and cheap", async () => {
    const app = makeApp();
    app.get("/twice", (req, res) => {
      const first = req.subdomains;
      const second = req.subdomains;
      res.json({ same: first === second, ips: req.ips === req.ips });
    });

    await request(app.server)
      .get("/twice")
      .set("Host", "a.b.example.com")
      .expect(200, { same: true, ips: true });
  });

  test("a handler that touches no compat accessor still works", async () => {
    // Guards the laziness: nothing above may be computed eagerly per request.
    const app = makeApp();
    app.get("/plain", (_req, res) => res.json({ ok: true }));
    await request(app.server).get("/plain").expect(200, { ok: true });
  });
});

// --- req.accepts family (Phase 7: negotiator wired) ---------------------------

describe("req.accepts family", () => {
  test("returns the offered type as written, or false", async () => {
    const app = makeApp();
    app.get("/a", (req, res) => {
      res.json({
        ext: req.accepts("json"),
        full: req.accepts("application/json"),
        miss: req.accepts("html"),
        array: req.accepts(["html", "json"]),
        spread: req.accepts("html", "json"),
        unknownExt: req.accepts("not-an-ext", "json"),
      });
    });
    await request(app.server).get("/a").set("Accept", "application/json").expect(200, {
      ext: "json",
      full: "application/json",
      miss: false,
      array: "json",
      spread: "json",
      unknownExt: "json",
    });
  });

  test("no Accept header: the first offered type wins; no arguments lists all", async () => {
    const app = makeApp();
    app.get("/a", (req, res) => {
      res.json({ first: req.accepts("html", "json"), list: req.accepts() });
    });
    await request(app.server)
      .get("/a")
      .expect(200, { first: "html", list: ["*/*"] });
  });

  test("encodings, charsets and languages follow the same shape", async () => {
    const app = makeApp();
    app.get("/a", (req, res) => {
      res.json({
        enc: req.acceptsEncodings("gzip", "identity"),
        encList: req.acceptsEncodings(),
        cs: req.acceptsCharsets(["utf-8"]),
        csMiss: req.acceptsCharsets("utf-16"),
        lang: req.acceptsLanguages("en", "fr"),
        langList: req.acceptsLanguages(),
      });
    });
    await request(app.server)
      .get("/a")
      .set("Accept-Encoding", "br;q=0.9, gzip")
      .set("Accept-Charset", "utf-8")
      .set("Accept-Language", "fr;q=0.8, en")
      .expect(200, {
        enc: "gzip",
        encList: ["gzip", "br", "identity"],
        cs: "utf-8",
        csMiss: false,
        lang: "en",
        langList: ["en", "fr"],
      });
  });

  test("identity;q=0 makes identity unacceptable", async () => {
    const app = makeApp();
    app.get("/a", (req, res) => {
      res.json({ enc: req.acceptsEncodings("identity"), list: req.acceptsEncodings() });
    });
    await request(app.server)
      .get("/a")
      .set("Accept-Encoding", "gzip, identity;q=0")
      .expect(200, { enc: false, list: ["gzip"] });
  });
});
