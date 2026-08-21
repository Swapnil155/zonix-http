import { ErrorCode, frameworkError } from "../errors/index.js";

/**
 * `trust proxy` — a zero-dependency equivalent of proxy-addr.
 *
 * Reimplemented rather than depended on, and deliberately faithful to
 * proxy-addr 2.0.7 + forwarded 0.2.0 down to the tokenizer, because getting
 * this subtly wrong is a security bug: too trusting and a client spoofs its own
 * IP through `X-Forwarded-For`, too strict and every request looks like it came
 * from the load balancer.
 *
 * **Default is off.** With no `trustProxy` option, `req.ip` is the socket
 * address and `X-Forwarded-*` is ignored entirely.
 */

/** `(address, hopIndex) => isTrusted` — compiled once per app, called per lookup. */
export type TrustFunction = (address: string | undefined, hop: number) => boolean;

export type TrustProxySetting = boolean | number | string | readonly string[] | TrustFunction;

interface Subnet {
  /** Network bytes, already masked. */
  network: Uint8Array;
  /** Prefix length in bits. */
  bits: number;
  /** 4 for IPv4, 16 for IPv6. */
  size: number;
}

/**
 * Named ranges, expanded exactly as proxy-addr does.
 *
 * `uniquelocal` is the RFC 1918 private space plus IPv6 ULA — note it does NOT
 * include loopback, so `trustProxy: "uniquelocal"` alone does not trust a
 * request arriving over 127.0.0.1.
 */
const PRESETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  loopback: ["127.0.0.1/8", "::1/128"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  uniquelocal: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
});

/** Compile any accepted `trustProxy` value into one predicate. */
export function compileTrust(setting: TrustProxySetting | undefined): TrustFunction {
  if (setting === undefined || setting === false) return trustNone;
  if (setting === true) return trustAll;
  if (typeof setting === "function") return setting;

  if (typeof setting === "number") {
    if (!Number.isInteger(setting) || setting < 0) {
      throw frameworkError(
        `trustProxy: a hop count must be a non-negative integer, received ${String(setting)}`,
        compileTrust,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    // Trust exactly the N hops nearest this server.
    return (_address, hop) => hop < setting;
  }

  const values = typeof setting === "string" ? setting.split(",") : setting;
  if (!Array.isArray(values)) {
    throw frameworkError(
      "trustProxy must be a boolean, a hop count, a comma-separated string, an array, or a function",
      compileTrust,
      ErrorCode.INVALID_ARGUMENT,
    );
  }

  const subnets: Subnet[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") {
      throw frameworkError(
        `trustProxy: every entry must be a string, received ${typeof raw}`,
        compileTrust,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    const value = raw.trim();
    if (value.length === 0) continue;
    for (const range of PRESETS[value] ?? [value]) subnets.push(parseSubnet(range, raw));
  }

  if (subnets.length === 0) return trustNone;
  return (address) => {
    const ip = address === undefined ? undefined : parseIp(address);
    if (ip === undefined) return false;
    for (const subnet of subnets) if (inSubnet(ip, subnet)) return true;
    return false;
  };
}

const trustNone: TrustFunction = () => false;
const trustAll: TrustFunction = () => true;

/**
 * Every address in play, nearest first: the socket address, then the
 * `X-Forwarded-For` chain read right to left.
 */
export function allAddresses(
  remoteAddress: string | undefined,
  forwardedHeader: string | undefined,
): string[] {
  const addresses: string[] = [remoteAddress ?? ""];
  if (forwardedHeader !== undefined) addresses.push(...parseForwarded(forwardedHeader));
  return addresses;
}

/**
 * Tokenize `X-Forwarded-For`, rightmost first.
 *
 * Scanned backwards, exactly as the `forwarded` package does. Only 0x20 counts
 * as padding: a token consisting solely of tabs survives as a token, which is
 * odd but is what real Express does, and this list feeds a security decision.
 */
export function parseForwarded(header: string): string[] {
  const list: string[] = [];
  let end = header.length;
  let start = header.length;

  for (let i = header.length - 1; i >= 0; i--) {
    switch (header.charCodeAt(i)) {
      case 0x20 /* space */:
        if (start === end) start = end = i;
        break;
      case 0x2c /* , */:
        if (start !== end) list.push(header.substring(start, end));
        start = end = i;
        break;
      default:
        start = i;
    }
  }
  if (start !== end) list.push(header.substring(start, end));
  return list;
}

/**
 * The addresses that are actually believable: the nearest-first list truncated
 * at the first hop that is not trusted.
 *
 * This is the security-critical half. With trust off the list collapses to just
 * the socket address, so a client cannot inject its own `X-Forwarded-For` chain
 * and have any of it believed.
 */
export function trustedAddresses(addresses: readonly string[], trust: TrustFunction): string[] {
  const out = addresses.slice();
  for (let i = 0; i < out.length - 1; i++) {
    if (trust(out[i], i)) continue;
    out.length = i + 1;
    break;
  }
  return out;
}

/**
 * The client address: walk outward from the socket while each hop is trusted,
 * and return the first one that is not.
 */
export function proxyAddress(addresses: readonly string[], trust: TrustFunction): string {
  let i = 0;
  for (; i < addresses.length - 1; i++) {
    if (!trust(addresses[i], i)) break;
  }
  return addresses[i] ?? "";
}

// --- address parsing ---------------------------------------------------------

interface ParsedIp {
  bytes: Uint8Array;
  size: 4 | 16;
}

/** Parse an IPv4 or IPv6 literal. Returns undefined for anything unparseable. */
export function parseIp(value: string): ParsedIp | undefined {
  // A zone index (fe80::1%eth0) plays no part in range matching.
  const zone = value.indexOf("%");
  const address = zone === -1 ? value : value.slice(0, zone);
  if (address.length === 0) return undefined;
  return address.includes(":") ? parseIpv6(address) : parseIpv4(address);
}

function parseIpv4(value: string): ParsedIp | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i] as string;
    if (part.length === 0 || part.length > 3 || !/^\d+$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    bytes[i] = n;
  }
  return { bytes, size: 4 };
}

function parseIpv6(value: string): ParsedIp | undefined {
  const halves = value.split("::");
  if (halves.length > 2) return undefined;

  const readGroups = (text: string): number[] | undefined => {
    if (text.length === 0) return [];
    const groups: number[] = [];
    for (const group of text.split(":")) {
      if (group.includes(".")) {
        // Trailing IPv4 form: ::ffff:127.0.0.1
        const v4 = parseIpv4(group);
        if (v4 === undefined) return undefined;
        groups.push(((v4.bytes[0] as number) << 8) | (v4.bytes[1] as number));
        groups.push(((v4.bytes[2] as number) << 8) | (v4.bytes[3] as number));
        continue;
      }
      if (group.length === 0 || group.length > 4 || !/^[0-9a-fA-F]+$/.test(group)) return undefined;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const head = readGroups(halves[0] as string);
  const tail = halves.length === 2 ? readGroups(halves[1] as string) : [];
  if (head === undefined || tail === undefined) return undefined;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return undefined;
    groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return undefined;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] as number) >> 8;
    bytes[i * 2 + 1] = (groups[i] as number) & 0xff;
  }
  return { bytes, size: 16 };
}

/** `::ffff:a.b.c.d` compared against an IPv4 range has to become `a.b.c.d` first. */
function toIpv4Mapped(ip: ParsedIp): ParsedIp | undefined {
  if (ip.size !== 16) return undefined;
  for (let i = 0; i < 10; i++) if (ip.bytes[i] !== 0) return undefined;
  if (ip.bytes[10] !== 0xff || ip.bytes[11] !== 0xff) return undefined;
  return { bytes: ip.bytes.slice(12), size: 4 };
}

function parseSubnet(range: string, original: string): Subnet {
  const slash = range.lastIndexOf("/");
  const addressPart = slash === -1 ? range : range.slice(0, slash);
  const ip = parseIp(addressPart);
  if (ip === undefined) {
    throw frameworkError(
      `trustProxy: ${JSON.stringify(original)} is not an IP address or CIDR range`,
      compileTrust,
      ErrorCode.INVALID_ARGUMENT,
    );
  }

  const maxBits = ip.size * 8;
  let bits = maxBits;
  if (slash !== -1) {
    const suffix = range.slice(slash + 1);
    if (!/^\d+$/.test(suffix)) {
      throw frameworkError(
        `trustProxy: ${JSON.stringify(original)} has an invalid prefix length`,
        compileTrust,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    bits = Number(suffix);
    if (bits > maxBits) {
      throw frameworkError(
        `trustProxy: ${JSON.stringify(original)} prefix length exceeds ${maxBits} bits`,
        compileTrust,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
  }

  const network = maskBytes(ip.bytes, bits);
  return { network, bits, size: ip.size };
}

function maskBytes(bytes: Uint8Array, bits: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const remaining = bits - i * 8;
    if (remaining >= 8) out[i] = bytes[i] as number;
    else if (remaining > 0) out[i] = (bytes[i] as number) & (0xff << (8 - remaining));
    else out[i] = 0;
  }
  return out;
}

function inSubnet(ip: ParsedIp, subnet: Subnet): boolean {
  let candidate: ParsedIp | undefined = ip;
  if (candidate.size !== subnet.size) {
    // The only cross-family comparison that means anything is a v4-mapped v6.
    candidate = subnet.size === 4 ? toIpv4Mapped(ip) : undefined;
    if (candidate === undefined) return false;
  }
  const masked = maskBytes(candidate.bytes, subnet.bits);
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== subnet.network[i]) return false;
  }
  return true;
}
