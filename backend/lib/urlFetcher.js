/**
 * URL fetcher + content extractor for URL-Speedrun (contract section 3.1).
 *
 * Server-side fetch of an external URL with SSRF protection (private-IP
 * blocking), an 8s timeout, a 1 MB size cap, regex-based HTML extraction, an
 * in-memory cache (60 min TTL) and a per-IP rate limit (10 fetches/h).
 *
 * Pure module — no Express, no new dependencies (Node 20+ globals only).
 */
import { createHash } from "crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import pngjs from "pngjs";
import jpeg from "jpeg-js";
const { PNG } = pngjs;

// ---- Tunables ---------------------------------------------------------

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_000_000; // 1 MB hard cap on accumulated body bytes.
const MAX_TOTAL_CONTENT_CHARS = 8_000;
const MAX_HEADINGS = 30;
const MAX_PARAGRAPHS = 50;
const MAX_PARAGRAPH_CHARS = 500;
const MAX_LINKS = 30;

const MAX_IMAGES = 3;
const ASCII_MAX_DIM = 64;
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
const IMAGE_MAX_BYTES = 500_000;
const ASCII_PER_IMAGE_TIMEOUT_MS = 4_000; // practical: network fetch + decode needs > 500ms
const ASCII_RAMP = " .:-=+*#%@";
// Output is downscaled to ASCII_MAX_DIM x ASCII_MAX_DIM, so a decoded image
// never needs more than a few megapixels. Without this cap, a tiny file can
// declare a huge width/height and force a multi-gigabyte decode allocation
// (security finding: PNG dimension bomb) before any real pixel data is read.
const MAX_IMAGE_PIXELS = 4_000_000; // ~4 MP
const MAX_REDIRECTS = 3;
const EXTRACTION_TIME_BUDGET_MS = 200; // wall-clock budget for HTML-extraction passes

const CACHE_TTL_MS = 60 * 60 * 1_000; // 60 min
const FETCH_RATE_LIMIT = 10; // per IP per hour
const FETCH_RATE_WINDOW_MS = 60 * 60 * 1_000;

const USER_AGENT = "cme-exe-observer/0.1 (+https://lab.medvesek.com)";
const ACCEPT = "text/html,application/xhtml+xml,application/xhtml+xml;q=0.9,*/*;q=0.5";

// ---- Error classes ----------------------------------------------------

/** URL failed client-side validation (scheme, hostname, DNS). */
export class UrlValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "UrlValidationError";
    this.code = "INVALID_URL";
  }
}

/** URL resolved to a private/loopback/link-local address (SSRF attempt). */
export class BlockedError extends Error {
  constructor(message = "URL resolves to a private network") {
    super(message);
    this.name = "BlockedError";
    this.code = "BLOCKED";
  }
}

/** Fetch exceeded the configured timeout. */
export class FetchTimeoutError extends Error {
  constructor(message = "URL took too long to respond") {
    super(message);
    this.name = "FetchTimeoutError";
    this.code = "TIMEOUT";
  }
}

/** Response body exceeded the size cap. */
export class TooLargeError extends Error {
  constructor(message = "URL response too large") {
    super(message);
    this.name = "TooLargeError";
    this.code = "TOO_LARGE";
  }
}

/** Generic fetch failure (non-200, network error, etc.). */
export class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "FetchError";
    this.code = "FETCH_FAILED";
  }
}

/**
 * The target site refuses automated/server-side visitors (bot wall).
 * Canonical case: LinkedIn returns its proprietary HTTP 999 authwall status
 * to any non-browser client — regardless of headers — so profile URLs can't
 * be fetched honestly (no cookie/login spoofing by design).
 */
export class TargetBlockedError extends Error {
  constructor(message = "The target site blocks automated visitors") {
    super(message);
    this.name = "TargetBlockedError";
    this.code = "TARGET_BLOCKED";
  }
}

/** Caller has hit the per-IP fetch rate limit. */
export class RateLimitError extends Error {
  /**
   * @param {number} retryAfterSec
   */
  constructor(retryAfterSec) {
    super("Too many URL fetches");
    this.name = "RateLimitError";
    this.code = "RATE_LIMIT";
    this.retryAfterSec = retryAfterSec;
  }
}

// ---- Private-IP / CIDR checks -----------------------------------------

/**
 * Parse a dotted-quad IPv4 string into a 32-bit unsigned integer, or null.
 * @param {string} str
 * @returns {number|null}
 */
function ipv4ToInt(str) {
  const parts = String(str).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = n * 256 + v;
    }
  return n >>> 0;
}

/**
 * Convert a CIDR mask length to a 32-bit mask (e.g. 8 → 0xff000000).
 * @param {number} bits
 * @returns {number}
 */
function ipv4Mask(bits) {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
}

/** @type {Array<{base:number, mask:number}>} */
const IPV4_PRIVATE = [
  { base: (ipv4ToInt("10.0.0.0") & ipv4Mask(8)) >>> 0, mask: ipv4Mask(8) }, // 10.0.0.0/8
  { base: (ipv4ToInt("172.16.0.0") & ipv4Mask(12)) >>> 0, mask: ipv4Mask(12) }, // 172.16.0.0/12
  { base: (ipv4ToInt("192.168.0.0") & ipv4Mask(16)) >>> 0, mask: ipv4Mask(16) }, // 192.168.0.0/16
  { base: (ipv4ToInt("127.0.0.0") & ipv4Mask(8)) >>> 0, mask: ipv4Mask(8) }, // 127.0.0.0/8
  { base: (ipv4ToInt("169.254.0.0") & ipv4Mask(16)) >>> 0, mask: ipv4Mask(16) }, // 169.254.0.0/16
  { base: (ipv4ToInt("0.0.0.0") & ipv4Mask(8)) >>> 0, mask: ipv4Mask(8) }, // 0.0.0.0/8
  { base: (ipv4ToInt("100.64.0.0") & ipv4Mask(10)) >>> 0, mask: ipv4Mask(10) }, // 100.64.0.0/10 (CGN)
  // Less-common reserved/special-purpose ranges (RFC 5735/6890) — low
  // practical SSRF risk (nothing sensitive is expected to live here), but
  // cheap to close alongside the ranges above (security hardening note).
  { base: (ipv4ToInt("192.0.0.0") & ipv4Mask(24)) >>> 0, mask: ipv4Mask(24) }, // 192.0.0.0/24 (IETF protocol assignments)
  { base: (ipv4ToInt("192.88.99.0") & ipv4Mask(24)) >>> 0, mask: ipv4Mask(24) }, // 192.88.99.0/24 (6to4 relay anycast)
  { base: (ipv4ToInt("198.18.0.0") & ipv4Mask(15)) >>> 0, mask: ipv4Mask(15) }, // 198.18.0.0/15 (benchmarking)
  { base: (ipv4ToInt("224.0.0.0") & ipv4Mask(4)) >>> 0, mask: ipv4Mask(4) }, // 224.0.0.0/4 (multicast)
  { base: (ipv4ToInt("240.0.0.0") & ipv4Mask(4)) >>> 0, mask: ipv4Mask(4) }, // 240.0.0.0/4 (reserved + 255.255.255.255 broadcast)
];

/**
 * @param {string} ip dotted-quad
 * @returns {boolean}
 */
function isPrivateIpv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const r of IPV4_PRIVATE) {
    if (((n & r.mask) >>> 0) === (r.base >>> 0)) return true;
  }
  return false;
}

/**
 * Parse an IPv6 string into 8 numeric groups, or null. Handles `::` shorthand.
 * Does NOT handle IPv4-mapped embedded dotted-quad form here (see
 * isPrivateIpv6 for that).
 * @param {string} str
 * @returns {number[]|null}
 */
function ipv6ToGroups(str) {
  const s = String(str);
  // Split off any zone-id (%eth0).
  const noZone = s.split("%")[0];
  // Detect an embedded IPv4 (last group is a.b.c.d).
  let cleaned = noZone;
  const v4Match = noZone.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match) {
    const v4 = ipv4ToInt(v4Match[1]);
    if (v4 === null) return null;
    const hi = (v4 >>> 16) & 0xffff;
    const lo = v4 & 0xffff;
    cleaned = noZone.slice(0, noZone.lastIndexOf(":")) + ":" + hi.toString(16) + ":" + lo.toString(16);
  }
  const parts = cleaned.split(":");
  const expand = parts.indexOf("");
  if (expand !== -1) {
    // Handle leading/trailing/double colons.
    const head = parts.slice(0, expand).filter(Boolean);
    const tail = parts.slice(expand + 1).filter(Boolean);
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    parts.splice(expand, parts.length - expand, ...new Array(missing).fill("0"), ...tail);
    // re-split (head was before expand)
    const rebuilt = [...head, ...parts.slice(expand).slice(0, missing), ...tail];
    if (rebuilt.length !== 8) return null;
    return rebuilt.map(g => {
      const n = parseInt(g || "0", 16);
      return Number.isFinite(n) && n >= 0 && n <= 0xffff ? n : null;
    }).some(x => x === null) ? null : rebuilt.map(g => parseInt(g || "0", 16));
  }
  if (parts.length !== 8) return null;
  const groups = parts.map(g => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    return parseInt(g, 16);
  });
  if (groups.some(g => g === null)) return null;
  return /** @type {number[]} */ (groups);
}

/** @type {Array<{groups:number[], mask:number}>} */
const IPV6_PRIVATE = [
  // ::1/128
  { groups: [0, 0, 0, 0, 0, 0, 0, 1], mask: 128 },
  // fc00::/7
  { groups: [0xfc00, 0, 0, 0, 0, 0, 0, 0], mask: 7 },
  // fe80::/10
  { groups: [0xfe80, 0, 0, 0, 0, 0, 0, 0], mask: 10 },
  // Less-common reserved ranges — same rationale as the IPv4 additions above.
  { groups: [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], mask: 32 }, // 2001:db8::/32 (documentation)
  { groups: [0xff00, 0, 0, 0, 0, 0, 0, 0], mask: 8 }, // ff00::/8 (multicast)
];

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIpv6(ip) {
  const groups = ipv6ToGroups(ip);
  if (!groups || groups.length !== 8) return false;
  // IPv4-mapped (::ffff:a.b.c.d) — re-check the mapped IPv4.
  if (
    groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && groups[5] === 0xffff
  ) {
    const v4 = (groups[6] << 16) | groups[7];
    const a = (v4 >>> 24) & 0xff;
    const b = (v4 >>> 16) & 0xff;
    const c = (v4 >>> 8) & 0xff;
    const d = v4 & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }
  for (const r of IPV6_PRIVATE) {
    const fullMaskGroups = Math.floor(r.mask / 16);
    const partialBits = r.mask % 16;
    let match = true;
    for (let i = 0; i < fullMaskGroups; i++) {
      if (groups[i] !== r.groups[i]) { match = false; break; }
    }
    if (match && partialBits > 0) {
      const pmask = (0xffff << (16 - partialBits)) & 0xffff;
      if ((groups[fullMaskGroups] & pmask) !== (r.groups[fullMaskGroups] & pmask)) {
        match = false;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Returns true if the address string is a private/loopback/link-local IP.
 * Accepts IPv4, IPv6, and IPv4-mapped IPv6.
 * @param {string} addr
 * @returns {boolean}
 */
function isPrivateAddress(addr) {
  if (/:\d*\.\d*\.\d*\.\d*$/.test(addr) || addr.includes(":")) {
    return isPrivateIpv6(addr);
  }
  return isPrivateIpv4(addr);
}

// ---- URL validation + DNS resolution ---------------------------------

/**
 * Normalize and validate the URL: must be http(s), must resolve via DNS,
 * and must not resolve to a private IP range.
 *
 * @param {string} rawUrl
 * @returns {Promise<{ url: string, host: string }>} normalized URL + lowercase hostname
 * @throws {UrlValidationError} bad scheme / unresolvable host
 * @throws {BlockedError} host resolves to a private network
 */
async function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new UrlValidationError("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlValidationError("Only http and https URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) throw new UrlValidationError("URL has no hostname");

  let records;
  try {
    // `lookup` with all:true returns both A and AAAA records.
    records = /** @type {any} */ (await dnsLookup(host, { all: true }));
  } catch {
    throw new UrlValidationError("Cannot resolve host");
  }
  const addrs = Array.isArray(records) ? records : [records];
  if (addrs.length === 0) throw new UrlValidationError("Cannot resolve host");
  for (const r of addrs) {
    if (r && typeof r.address === "string" && isPrivateAddress(r.address)) {
      throw new BlockedError();
    }
  }
  // Drop fragment + userinfo (never useful for server-side fetch, avoids
  // accidental key leakage). Keep the rest of the URL intact.
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  return { url: parsed.toString(), host };
}

/**
 * Fetch `url`, following redirects manually and re-running the full
 * validateUrl() check (private-IP/DNS validation) on every hop's target
 * before following it. `redirect:"follow"` would transparently fetch
 * whatever Location header a first-hop-public, attacker-controlled server
 * sends back -- including a private/internal address -- since validateUrl()
 * only ever checked the original hostname (security finding: SSRF via
 * unvalidated redirect). A single timeout covers the whole chain, not each
 * hop, so a malicious multi-hop chain can't use up more than one request's
 * time budget.
 *
 * ponytail: the DNS lookup here and the one fetch() performs internally at
 * connect time are still two independent resolutions (no IP pinning), so a
 * DNS-rebinding attacker controlling their own authoritative DNS with a
 * short TTL could in principle still swap the address between the two --
 * closing that needs pinning the validated IP for the actual connection
 * (e.g. via a custom undici dispatcher `connect.lookup`), which is a bigger,
 * riskier change than this fix. The redirect bypass this closes was the
 * confirmed, trivially-exploitable vector; rebinding needs attacker-
 * controlled authoritative DNS and precise timing, a materially higher bar.
 *
 * @param {string} url
 * @param {RequestInit} fetchOpts
 * @param {number} timeoutMs
 * @returns {Promise<{ response: Response, finalUrl: string }>}
 * @throws {UrlValidationError|BlockedError}
 */
async function fetchValidated(url, fetchOpts, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  let currentUrl = (await validateUrl(url)).url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(currentUrl, { ...fetchOpts, redirect: "manual", signal });
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = isRedirect ? response.headers.get("location") : null;
    if (!location) return { response, finalUrl: currentUrl };
    const nextUrl = new URL(location, currentUrl).toString();
    currentUrl = (await validateUrl(nextUrl)).url; // re-validate EVERY hop, not just the first
  }
  throw new UrlValidationError("Too many redirects");
}

// ---- Per-IP fetch rate limiter (in-memory) ---------------------------

/** @type {Map<string, { count: number, windowStart: number }>} */
const fetchBuckets = new Map();

/**
 * Throws RateLimitError if `ip` has exceeded the per-hour fetch budget.
 * @param {string} ip
 * @returns {void}
 */
function enforceFetchRateLimit(ip) {
  if (!ip) return;
  const now = Date.now();
  let bucket = fetchBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > FETCH_RATE_WINDOW_MS) {
    bucket = { count: 1, windowStart: now };
    fetchBuckets.set(ip, bucket);
    return;
  }
  if (bucket.count >= FETCH_RATE_LIMIT) {
    throw new RateLimitError(Math.ceil((FETCH_RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000));
  }
  bucket.count += 1;
}

// ---- In-memory cache --------------------------------------------------

/** @type {Map<string, { content: any, expiresAt: number }>} */
const cache = new Map();

/**
 * @param {string} normalizedUrl
 * @returns {string}
 */
function cacheKey(normalizedUrl) {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}

/**
 * Read a cached entry if present and not expired. Lazily evicts on miss.
 * @param {string} normalizedUrl
 * @returns {any|null}
 */
function readCache(normalizedUrl) {
  const key = cacheKey(normalizedUrl);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.content;
}

/**
 * @param {string} normalizedUrl
 * @param {any} content
 * @returns {void}
 */
function writeCache(normalizedUrl, content) {
  cache.set(cacheKey(normalizedUrl), { content, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---- HTML utilities ---------------------------------------------------

/**
 * Decode a small set of named/numeric HTML entities. Sufficient for display;
 * not a full entity table.
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(Number(d)));
}

/**
 * @param {number} code
 * @returns {string}
 */
function safeFromCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * All (non-overlapping) indices of a literal substring, in order.
 * @param {string} haystack
 * @param {string} needle
 * @returns {number[]}
 */
function allIndices(haystack, needle) {
  const out = [];
  for (let idx = haystack.indexOf(needle); idx !== -1; idx = haystack.indexOf(needle, idx + needle.length)) {
    out.push(idx);
  }
  return out;
}

/**
 * Remove every `open...close` literal-delimited span from `html` (used for
 * HTML comments). Finds all open/close delimiter positions in two single
 * forward passes, then pairs them with a monotonic two-pointer walk — O(n)
 * total even when `open` appears many times with no matching `close`
 * anywhere, unlike a backtracking `open[\s\S]*?close` regex (which is
 * O(n^2) in exactly that adversarial case — see the DoS security finding
 * this function was rewritten to fix).
 * @param {string} html
 * @param {string} open
 * @param {string} close
 * @returns {string}
 */
function stripLiteralPairs(html, open, close) {
  const opens = allIndices(html, open);
  if (opens.length === 0) return html;
  const closes = allIndices(html, close);
  let result = "";
  let cursor = 0;
  let closePtr = 0;
  for (const openIdx of opens) {
    if (openIdx < cursor) continue; // inside a span we already removed
    while (closePtr < closes.length && closes[closePtr] < openIdx + open.length) closePtr++;
    if (closePtr >= closes.length) break; // no close left for this or any later open
    result += html.slice(cursor, openIdx);
    cursor = closes[closePtr] + close.length;
    closePtr++;
  }
  result += html.slice(cursor);
  return result;
}

/**
 * Call `onMatch(attrs, inner, outerEnd)` for each `<tag ...>...</tag>` pair
 * in document order, in O(n) total time regardless of how many `<tag>`s are
 * unclosed (unlike a backtracking `<tag\b[^>]*>([\s\S]*?)<\/tag>` regex,
 * which degrades to O(n^2) on adversarial input with many unclosed tags —
 * see the DoS security finding this function was written to fix). Stops
 * early if `onMatch` returns true, or once EXTRACTION_TIME_BUDGET_MS is
 * exceeded (defense in depth against any pathological case this doesn't
 * already handle).
 * @param {string} html
 * @param {string} tag
 * @param {(attrs: string, inner: string, outerEnd: number) => boolean | void} onMatch
 */
function forEachTagPair(html, tag, onMatch) {
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  const lowerHtml = html.toLowerCase();
  const closePositions = allIndices(lowerHtml, `</${tag.toLowerCase()}`);
  const deadline = Date.now() + EXTRACTION_TIME_BUDGET_MS;
  let closePtr = 0;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    if (Date.now() > deadline) break;
    const innerStart = m.index + m[0].length;
    while (closePtr < closePositions.length && closePositions[closePtr] < innerStart) closePtr++;
    if (closePtr >= closePositions.length) break;
    const closeStart = closePositions[closePtr];
    const gt = html.indexOf(">", closeStart);
    const outerEnd = gt === -1 ? html.length : gt + 1;
    closePtr++;
    const stop = onMatch(m[1] || "", html.slice(innerStart, closeStart), outerEnd);
    openRe.lastIndex = outerEnd;
    if (stop) break;
  }
}

/**
 * Strip tags we never want content from: script, style, nav, footer, svg,
 * noscript, template, and HTML comments. Operates on a copy.
 * @param {string} html
 * @returns {string}
 */
function stripNoise(html) {
  let out = stripLiteralPairs(html, "<!--", "-->");
  for (const tag of ["script", "style", "nav", "footer", "svg", "noscript", "template", "head", "iframe", "form"]) {
    const ranges = [];
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    const lowerOut = out.toLowerCase();
    const closePositions = allIndices(lowerOut, `</${tag}`);
    let closePtr = 0;
    let m;
    while ((m = openRe.exec(out)) !== null) {
      const innerStart = m.index + m[0].length;
      while (closePtr < closePositions.length && closePositions[closePtr] < innerStart) closePtr++;
      if (closePtr >= closePositions.length) break;
      const closeStart = closePositions[closePtr];
      const gt = out.indexOf(">", closeStart);
      const outerEnd = gt === -1 ? out.length : gt + 1;
      ranges.push({ start: m.index, end: outerEnd });
      closePtr++;
      openRe.lastIndex = outerEnd;
    }
    if (ranges.length > 0) {
      let result = "";
      let cursor = 0;
      for (const r of ranges) {
        result += out.slice(cursor, r.start) + " ";
        cursor = r.end;
      }
      result += out.slice(cursor);
      out = result;
    }
  }
  return out;
}

/**
 * Capture the inner text of every tag named `tag` in `html` (post-strip).
 * @param {string} html
 * @param {string} tag e.g. "h1"
 * @param {number} max
 * @returns {string[]}
 */
function extractTagTexts(html, tag, max) {
  const out = [];
  forEachTagPair(html, tag, (_attrs, inner) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (text) out.push(text);
    return out.length >= max;
  });
  return out;
}

/**
 * Extract anchor links that point to http(s) or site-relative URLs.
 * Drops mailto/tel/javascript/anchor-only links and image-only anchors.
 * @param {string} html
 * @param {number} max
 * @returns {Array<{ title: string, href: string }>}
 */
function extractLinks(html, max) {
  const out = [];
  forEachTagPair(html, "a", (attrs, inner) => {
    const hrefMatch = attrs.match(/\bhref\s*=\s*"([^"]*)"/i) || attrs.match(/\bhref\s*=\s*'([^']*)'/i);
    if (!hrefMatch) return false;
    let href = decodeEntities(hrefMatch[1].trim());
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") ||
        href.startsWith("javascript:") || href.startsWith("data:")) return false;
    if (!/^(https?:\/\/|\/|\.\/|\.\.\/)/.test(href)) return false; // skip protocol-relative too
    const title = decodeEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!title) return false;
    // Skip pure image anchors (no meaningful text).
    if (/^[\s]*$/.test(title)) return false;
    out.push({ title, href });
    return out.length >= max;
  });
  return out;
}

/**
 * Pull `<meta name="description" content="...">` (or og:description).
 * @param {string} html
 * @returns {string}
 */
function extractMetaDescription(html) {
  const m =
    html.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i) ||
    html.match(/<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*>/i);
  if (!m) return "";
  const c = m[0].match(/\bcontent\s*=\s*"([^"]*)"/i) || m[0].match(/\bcontent\s*=\s*'([^']*)'/i);
  return c ? decodeEntities(c[1].trim()) : "";
}

/**
 * Pull `<title>...</title>`.
 * @param {string} html
 * @returns {string}
 */
function extractTitleTag(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!m) return "";
  return decodeEntities(m[1].replace(/\s+/g, " ").trim());
}

/**
 * Read an attribute value from an HTML attribute string.
 * @param {string} attrs  raw attribute string e.g. 'src="foo" class="bar"'
 * @param {string} name   attribute name
 * @returns {string}
 */
function readAttr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ||
            attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? decodeEntities(m[1].trim()) : "";
}

/**
 * Classify an image into kind based on alt text and class keywords.
 * @param {string} alt
 * @param {string} className
 * @returns {"avatar"|"logo"|"header"|null}
 */
function classifyImageKind(alt, className) {
  const blob = `${alt || ""} ${className || ""}`.toLowerCase();
  if (/\b(avatar|profile|portrait|headshot|mw-userlinks)\b/.test(blob)) return "avatar";
  if (/\blogo\b/.test(blob)) return "logo";
  if (/\b(header|wikitopbanner)\b/.test(blob)) return "header";
  return null;
}

/**
 * Find ranges of table blocks matching a class keyword (e.g. infobox, sidebar).
 * @param {string} html
 * @param {string} blockClass  class keyword to match inside class attr
 * @returns {Array<{start:number, end:number}>}
 */
function findBlockRanges(html, blockClass) {
  // Same two-pointer linear scan as forEachTagPair, but with a class-filtered
  // open-tag pattern that helper doesn't support — see forEachTagPair's doc
  // comment for why this avoids the backtracking-regex DoS.
  const ranges = [];
  const openRe = new RegExp(`<table\\b[^>]*class\\s*=\\s*"[^"]*\\b${blockClass}\\b[^"]*"[^>]*>`, "gi");
  const lowerHtml = html.toLowerCase();
  const closePositions = allIndices(lowerHtml, "</table");
  let closePtr = 0;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const innerStart = m.index + m[0].length;
    while (closePtr < closePositions.length && closePositions[closePtr] < innerStart) closePtr++;
    if (closePtr >= closePositions.length) break;
    const closeStart = closePositions[closePtr];
    const gt = html.indexOf(">", closeStart);
    const outerEnd = gt === -1 ? html.length : gt + 1;
    ranges.push({ start: m.index, end: outerEnd });
    closePtr++;
    openRe.lastIndex = outerEnd;
  }
  return ranges;
}

/**
 * Check if a position falls within any of the given ranges.
 * @param {number} idx
 * @param {Array<{start:number, end:number}>} ranges
 * @returns {boolean}
 */
function inRanges(idx, ranges) {
  for (const r of ranges) {
    if (idx >= r.start && idx < r.end) return true;
  }
  return false;
}

/**
 * Extract up to `max` candidate image objects from HTML.
 * Prioritises images inside infobox/sidebar blocks (Wikipedia) or images whose
 * alt/class matches avatar/profile/logo/header keywords, or images inside
 * header/profile/avatar/hero containers.
 *
 * @param {string} html  (cleaned HTML, post stripNoise)
 * @param {number} max
 * @returns {Array<{src:string, alt:string, kind:"avatar"|"logo"|"header", width?:number, height?:number}>}
 */
function extractImages(html, max) {
  const infoboxRanges = findBlockRanges(html, "infobox");
  const sidebarRanges = findBlockRanges(html, "sidebar");
  const candidates = [];
  const seen = new Set();
  const re = /<img\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || "";
    const srcVal = readAttr(attrs, "src");
    if (!srcVal || !/^https?:\/\//i.test(srcVal)) continue;
    if (seen.has(srcVal)) continue;
    seen.add(srcVal);
    const alt = readAttr(attrs, "alt");
    const className = readAttr(attrs, "class");
    const kind = classifyImageKind(alt, className);
    const inSpecialBlock = inRanges(m.index, infoboxRanges) || inRanges(m.index, sidebarRanges);
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const inHeaderTag = /<header\b/i.test(before.slice(-400));
    const inProfileContainer = /<(?:div|figure|section)\b[^>]*class\s*=\s*"[^"]*\b(profile|avatar|hero)\b/i.test(before);
    const include = kind !== null || inSpecialBlock || inHeaderTag || inProfileContainer;
    if (!include) continue;
    const item = { src: srcVal, alt, kind: kind || (inSpecialBlock ? "avatar" : "header") };
    const w = readAttr(attrs, "width");
    const h = readAttr(attrs, "height");
    if (/^\d+$/.test(w)) item.width = Number(w);
    if (/^\d+$/.test(h)) item.height = Number(h);
    candidates.push(item);
    if (candidates.length >= max) break;
  }
  return candidates;
}

// ---- Subject / sections assembly -------------------------------------

/**
 * Strip common site suffixes from a title — e.g. "Jane Doe | LinkedIn",
 * "Foo — GitHub", "Title · Site". Conservative; only trims a single trailing
 * separator + site word.
 * @param {string} title
 * @returns {string}
 */
function stripSiteSuffix(title) {
  return String(title || "")
    .replace(/\s*[|·–—-]\s*(LinkedIn|GitHub|Twitter|X|Instagram|Dribbble|Behance|Medium|Substack|Personal Website|Portfolio|Homepage).?$/i, "")
    .trim();
}

/**
 * Slugify a string into a stable lowercase id.
 * @param {string} s
 * @returns {string}
 */
function slugify(s) {
  const slug = String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

/**
 * Hardcoded skill-term list used for a best-effort `skills` section. Matches
 * are case-insensitive whole-word.
 */
const SKILL_TERMS = [
  "JavaScript", "TypeScript", "Python", "Rust", "Go", "Java", "Kotlin", "Swift",
  "React", "Vue", "Svelte", "Next.js", "Node.js", "Deno", "GraphQL", "REST",
  "HTML", "CSS", "Tailwind", "Sass", "WebGL", "Three.js", "Canvas", "SVG",
  "Figma", "Sketch", "Photoshop", "Illustrator", "After Effects", "Blender",
  "Design Systems", "UX", "UI", "Interaction Design", "Product Design",
  "Brand Identity", "Typography", "Motion Design", "3D Modeling", "Animation",
  "Machine Learning", "AI", "LLM", "Computer Vision", "Data Visualization",
  "Accessibility", "Performance", "DevOps", "Docker", "Kubernetes", "AWS",
  "Prototyping", "Research", "Strategy", "Leadership", "Mentoring",
];

/**
 * Build a unique, order-preserved list of skill terms found anywhere in the
 * extracted text blobs.
 * @param {string[]} haystacks
 * @returns {string[]}
 */
function findSkills(haystacks) {
  const blob = haystacks.filter(Boolean).join(" \n ");
  const found = new Set();
  for (const term of SKILL_TERMS) {
    const re = new RegExp(`\\b${term.replace(/[.+*?^$()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(blob)) found.add(term);
  }
  return [...found];
}

/**
 * Decide whether a heading or link title looks like a "work item" — has at
 * least 3 words and is not obviously navigation.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeWorkItem(text) {
  const t = String(text || "").trim();
  if (t.length < 4) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  if (/^(home|about|contact|login|sign in|sign up|menu|search|blog|posts|subscribe|newsletter)$/i.test(t)) {
    return false;
  }
  return true;
}

/**
 * Pick the most likely subject name from headings/title.
 * @param {string[]} h1s
 * @param {string} titleTag
 * @returns {string}
 */
function inferName(h1s, titleTag) {
  const fromH1 = h1s.find((h) => h && h.trim().length >= 2);
  return stripSiteSuffix(fromH1 || titleTag || "");
}

/**
 * Assemble the structured ExtractedContent object from raw extracted parts.
 * @param {{ url:string, finalUrl:string, titleTag:string, description:string, h1s:string[], h2s:string[], h3s:string[], paragraphs:string[], links:Array<{title:string,href:string}>, contentLengthBytes:number, isHtml:boolean }} parts
 * @returns {any}
 */
function assembleContent(parts) {
  const {
    url, finalUrl, titleTag, description, h1s, h2s, h3s, paragraphs, links,
    contentLengthBytes, isHtml, images,
  } = parts;

  const name = inferName(h1s, titleTag);
  const role = h2s[0] || (description ? description.slice(0, 80) : "");

  // works: top headings + link titles that look like work items (max 10, unique).
  const seenWorkSlugs = new Set();
  const works = [];
  const pushWork = (title, href) => {
    if (works.length >= 10) return;
    if (!looksLikeWorkItem(title)) return;
    const slug = slugify(title);
    if (seenWorkSlugs.has(slug)) return;
    seenWorkSlugs.add(slug);
    const item = { id: slug, title };
    if (href) item.href = href;
    works.push(item);
  };
  for (const h of [...h2s, ...h3s]) pushWork(h);
  for (const l of links) pushWork(l.title, l.href);

  // skills: best-effort keyword scan across headings + paragraphs.
  const skills = findSkills([...h1s, ...h2s, ...h3s, ...paragraphs])
    .slice(0, 20)
    .map((title) => ({ id: slugify(title), title }));

  // Assemble the canonical sections array (contract ExtractedContent shape).
  const sections = [
    {
      id: "hero",
      title: name || "Unknown subject",
      items: role
        ? [{ id: slugify(role), title: role }]
        : [],
    },
    {
      id: "about",
      title: "About",
      items: description
        ? [{ id: slugify(description.slice(0, 40)), title: description.slice(0, 200), description }]
        : [],
    },
    { id: "works", title: "Work", items: works },
    { id: "skills", title: "Skills", items: skills },
  ];

  return {
    url,
    finalUrl,
    title: titleTag || name || "",
    description,
    subject: { name: name || "", role, location: null, images: images || [] },
    sections,
    fetchedAt: new Date().toISOString(),
    contentLengthBytes,
    isHtml,
    images: images || [],
  };
}


// ---- Image → ASCII conversion -----------------------------------------

/**
 * Detect image format from Content-Type header and magic bytes.
 * @param {string} contentType
 * @param {Buffer} buf
 * @returns {"png"|"jpeg"|"svg"|null}
 */
function detectFormat(contentType, buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4d) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return "jpeg";
  if (ct.includes("image/svg") || ct.includes("image/xml")) return "svg";
  if (buf.length > 0 && buf[0] === 0x3c) {
    const head = buf.slice(0, Math.min(256, buf.length)).toString("utf8").trim().toLowerCase();
    if (head.startsWith("<?xml") || head.startsWith("<svg")) return "svg";
  }
  return null;
}

/**
 * Read a PNG's declared width/height straight out of its IHDR chunk, without
 * decoding any pixel data. PNG layout: 8-byte signature, then a 4-byte chunk
 * length, 4-byte "IHDR", then width/height as big-endian uint32 — i.e. at
 * fixed offsets 16 and 20 for any valid PNG.
 * @param {Buffer} buf
 * @returns {{ width: number, height: number } | null}
 */
function readPngDimensions(buf) {
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Decode PNG or JPEG buffer into { data: Buffer, width, height } (RGBA).
 * Returns null for unsupported formats, or when the image's declared
 * dimensions exceed MAX_IMAGE_PIXELS (checked before decoding so a tiny file
 * with an inflated header can't force a huge allocation — see
 * MAX_IMAGE_PIXELS above).
 * @param {Buffer} buf
 * @param {string} format
 * @returns {{ data: Buffer, width: number, height: number } | null}
 */
function decodeImage(buf, format) {
  if (format === "png") {
    const dims = readPngDimensions(buf);
    if (!dims || dims.width * dims.height > MAX_IMAGE_PIXELS) return null;
    try { return PNG.sync.read(buf); } catch { return null; }
  }
  if (format === "jpeg") {
    try {
      // jpeg-js already defaults maxResolutionInMP/maxMemoryUsageInMB, but
      // pin them to the same budget as PNG for consistency.
      return jpeg.decode(buf, { useTArray: false, maxResolutionInMP: MAX_IMAGE_PIXELS / 1_000_000 });
    } catch { return null; }
  }
  return null;
}

/**
 * Downscale decoded RGBA image and convert to ASCII art string.
 * Target max dimension: ASCII_MAX_DIM. Preserves aspect ratio.
 * Luminosity: 0.299R + 0.587G + 0.114B.
 *
 * @param {{ data: Buffer, width: number, height: number }} img
 * @returns {string}
 */
function downscaleAndAscii(img) {
  const { data, width, height } = img;
  const maxDim = ASCII_MAX_DIM;
  let tw = width;
  let th = height;
  if (width >= height) {
    if (width > maxDim) { tw = maxDim; th = Math.max(1, Math.round(height * maxDim / width)); }
  } else {
    if (height > maxDim) { th = maxDim; tw = Math.max(1, Math.round(width * maxDim / height)); }
  }
  const xRatio = width / tw;
  const yRatio = height / th;
  const lines = [];
  for (let ty = 0; ty < th; ty++) {
    let line = "";
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * xRatio);
      const y0 = Math.floor(ty * yRatio);
      const x1 = Math.min(width, Math.floor((tx + 1) * xRatio));
      const y1 = Math.min(height, Math.floor((ty + 1) * yRatio));
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          rSum += data[i];
          gSum += data[i + 1];
          bSum += data[i + 2];
          count++;
        }
      }
      if (count === 0) count = 1;
      const lum = (0.299 * (rSum / count) + 0.587 * (gSum / count) + 0.114 * (bSum / count));
      // Ramp[0] = ' ' (lightest ink) → Ramp[last] = '@' (darkest ink)
      // Dark pixel (lum low) → dark char (high index)
      const idx = Math.min(ASCII_RAMP.length - 1, Math.floor((1 - lum / 255) * ASCII_RAMP.length));
      line += ASCII_RAMP[idx];
    }
    line = line.replace(/\s+$/, "");
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Attempt to convert a fetched image URL to ASCII art.
 * Fetches the image (with SSRF protection + timeout + size cap), detects format,
 * decodes, downscales, and renders as ASCII. Returns null on any failure.
 *
 * @param {string} imageUrl
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string | null>}
 */
export async function imageToAscii(imageUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || ASCII_PER_IMAGE_TIMEOUT_MS;
  try {
    const result = await Promise.race([
      (async () => {
        const { response } = await fetchValidated(
          imageUrl,
          { method: "GET", headers: { "User-Agent": USER_AGENT } },
          IMAGE_FETCH_TIMEOUT_MS
        );
        if (!response.ok) return null;
        const contentType = response.headers.get("content-type") || "";
        const chunks = [];
        let total = 0;
        const reader = response.body?.getReader();
        if (reader) {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > IMAGE_MAX_BYTES) { try { await reader.cancel(); } catch {} return null; }
            chunks.push(value);
          }
        } else {
          const ab = await response.arrayBuffer();
          total = ab.byteLength;
          if (total > IMAGE_MAX_BYTES) return null;
          chunks.push(new Uint8Array(ab));
        }
        const buf = Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c)));
        const format = detectFormat(contentType, buf);
        if (!format) return null;
        if (format === "svg") {
          const text = buf.toString("utf8").replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          return text || null;
        }
        const decoded = decodeImage(buf, format);
        if (!decoded || !decoded.data || !decoded.width || !decoded.height) return null;
        return downscaleAndAscii(decoded);
      })(),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return result;
  } catch {
    return null;
  }
}

// ---- Public: fetchAndExtract -----------------------------------------

/**
 * Hosts that wall off server-side visitors entirely (login walls / bot
 * walls). For these we skip the live fetch and go straight to the Wayback
 * Machine — no honest direct path exists, and burning the timeout on a
 * guaranteed wall just wastes the visitor's rate-limit budget.
 */
const KNOWN_WALLED_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "lnkd.in",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "fb.com",
  "m.facebook.com",
  "twitter.com",
  "x.com",
  "www.x.com",
]);

/**
 * @param {string} host lowercase hostname
 * @returns {boolean}
 */
function isKnownWalledHost(host) {
  return KNOWN_WALLED_HOSTS.has(host) || KNOWN_WALLED_HOSTS.has(host.replace(/^[^.]+\./, ""));
}

const WAYBACK_CDX_URL = "https://web.archive.org/cdx/search/cdx";
// archive.org is slow from server networks (6-8s per CDX answer measured in
// the container) — the generic 8s fetch timeout truncates legit lookups, so
// archive requests get their own, roomier budget.
const WAYBACK_TIMEOUT_MS = 20_000;

/**
 * Negative cache for snapshot lookups. archive.org's CDX edge rate-limits
 * hard (intermittent 503/429, roughly a dozen requests/minute per IP), so a
 * "no snapshot" answer is remembered for 10 minutes — repeat visitors with
 * the same walled URL don't hammer the archive.
 * @type {Map<string, number>}
 */
const waybackNegativeCache = new Map();
const WAYBACK_NEGATIVE_TTL_MS = 10 * 60 * 1000;

/**
 * Look up the newest Wayback snapshot for a URL via the CDX API.
 *
 * The friendlier availability API under-reports walled sites — LinkedIn
 * profiles often surface only as "warc/revisit" records there and the API
 * answers with an empty set even though real 200 captures exist. CDX with an
 * explicit statuscode:200 filter finds them. The snapshot URL uses the `id_`
 * modifier so the Wayback toolbar is NOT injected into the served HTML.
 *
 * @param {string} normalizedUrl
 * @returns {Promise<{ url: string, timestamp: string } | null>} null when no usable snapshot
 */
async function findWaybackSnapshot(normalizedUrl) {
  const negAt = waybackNegativeCache.get(normalizedUrl);
  if (negAt && Date.now() - negAt < WAYBACK_NEGATIVE_TTL_MS) return null;

  const cdx =
    WAYBACK_CDX_URL +
    "?url=" + encodeURIComponent(normalizedUrl) +
    "&output=json&filter=statuscode:200&limit=-3&fl=timestamp,original&collapse=digest";
  // archive.org's CDX edge intermittently answers 503 under load — retry
  // once with a short backoff, then remember the miss for a while.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { response } = await fetchValidated(
        cdx,
        { method: "GET", headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
        WAYBACK_TIMEOUT_MS
      );
      if (response.status === 503 || response.status === 429) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        break;
      }
      if (!response.ok) break;
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length < 2) break;
      // limit=-3 returns the LAST 3 captures ascending — take the newest.
      const last = rows[rows.length - 1];
      const ts = String(last[0] || "");
      const original = String(last[1] || "");
      if (!/^\d{14}$/.test(ts) || !/^https?:\/\//i.test(original)) break;
      return { url: `https://web.archive.org/web/${ts}id_/${original}`, timestamp: ts };
    } catch {
      if (attempt === 1) break; // archive.org down / timeout
    }
  }
  waybackNegativeCache.set(normalizedUrl, Date.now());
  return null;
}

/**
 * Fetch the archived version of a walled URL through the Wayback Machine.
 * The snapshot URL itself goes through the same SSRF-validated pipeline
 * (http/https only, public host — web.archive.org), so no new request
 * surface is opened.
 *
 * @param {string} normalizedUrl the original (walled) URL
 * @returns {Promise<any>} ExtractedContent with origin "archive"
 * @throws {TargetBlockedError} when no usable snapshot exists
 */
async function fetchViaWayback(normalizedUrl) {
  const snapshot = await findWaybackSnapshot(normalizedUrl);
  if (!snapshot) {
    throw new TargetBlockedError(
      "The target site blocks automated visitors and no archived snapshot was found — paste the page content instead."
    );
  }
  const content = await fetchAndExtractDirect(snapshot.url, WAYBACK_TIMEOUT_MS);
  // Re-tag provenance: the visitor asked for the original URL; the archive
  // is just the lens we read it through.
  content.url = normalizedUrl;
  content.finalUrl = snapshot.url;
  content.origin = "archive";
  content.archivedAt = snapshot.timestamp
    ? snapshot.timestamp.replace(/^(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3")
    : "";
  return content;
}

/**
 * Validate, fetch, and extract content from an external URL — with the
 * Wayback fallback for bot-walled sites (LinkedIn & co).
 *
 * @param {string} url
 * @param {{ ip?: string }} [opts]
 * @returns {Promise<any>} ExtractedContent
 * @throws {UrlValidationError|BlockedError|FetchTimeoutError|TooLargeError|FetchError|TargetBlockedError|RateLimitError}
 */
export async function fetchAndExtract(url, opts = {}) {
  const ip = opts && typeof opts.ip === "string" ? opts.ip : "";
  enforceFetchRateLimit(ip);

  const { url: normalizedUrl, host } = await validateUrl(url);

  const cached = readCache(normalizedUrl);
  if (cached) return cached;

  if (isKnownWalledHost(host)) {
    const content = await fetchViaWayback(normalizedUrl);
    writeCache(normalizedUrl, content);
    return content;
  }

  try {
    return await fetchAndExtractDirect(normalizedUrl);
  } catch (err) {
    if (err instanceof TargetBlockedError) {
      const content = await fetchViaWayback(normalizedUrl);
      writeCache(normalizedUrl, content);
      return content;
    }
    throw err;
  }
}

/**
 * Validate, fetch, and extract content from a single URL. No rate limit
 * (the public {@link fetchAndExtract} owns that), no archive fallback —
 * fetchViaWayback calls this for the snapshot so the two paths can't loop.
 *
 * @param {string} normalizedUrl
 * @param {number} [timeoutMs=FETCH_TIMEOUT_MS] per-chain fetch budget
 * @returns {Promise<any>} ExtractedContent
 */
async function fetchAndExtractDirect(normalizedUrl, timeoutMs = FETCH_TIMEOUT_MS) {
  const host = hostnameForLog(normalizedUrl);

  let response;
  let finalUrl = normalizedUrl;
  try {
    ({ response, finalUrl } = await fetchValidated(
      normalizedUrl,
      { method: "GET", headers: { "User-Agent": USER_AGENT, Accept: ACCEPT } },
      timeoutMs
    ));
  } catch (err) {
    // A redirect hop that fails validateUrl() (bad scheme, unresolvable, or
    // a private address) throws UrlValidationError/BlockedError directly --
    // let those through as-is rather than masking them as a generic fetch
    // failure, same as the original (unvalidated) hostname would.
    if (err instanceof UrlValidationError || err instanceof BlockedError) throw err;
    const name = err && err.name;
    if (name === "TimeoutError" || name === "AbortError") throw new FetchTimeoutError();
    throw new FetchError(`Could not fetch URL (${host})`);
  }

  if (!response.ok) {
    // HTTP 999 is LinkedIn's anti-bot authwall status (other walls may reuse
    // it). Browsers pass, every server-side client gets 999 — no honest way
    // around it, so surface it as its own error instead of a generic failure.
    if (response.status === 999) {
      const isLinkedIn = /(^|\.)(linkedin\.com|linkedin\.com\.[a-z]{2}|lnkd\.in)$/i.test(host);
      throw new TargetBlockedError(
        isLinkedIn
          ? "LinkedIn blocks automated visitors (authwall) — profiles can't be read by the Observer."
          : "The target site blocks automated visitors."
      );
    }
    throw new FetchError(`Target returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const isHtml = /text\/html|application\/xhtml/i.test(contentType);

  // Stream the body with a hard byte cap so a malicious "infinite" response
  // can't exhaust memory.
  const contentLengthHeader = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLengthHeader) && contentLengthHeader > MAX_BYTES) {
    throw new TooLargeError();
  }

  let html = "";
  let bytes = 0;
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      // No streaming body available — read all at once (still bounded by the
      // Content-Length check above).
      html = await response.text();
      bytes = html.length;
    } else {
      const decoder = new TextDecoder("utf-8");
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          try { await reader.cancel(); } catch { /* noop */ }
          throw new TooLargeError();
        }
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    }
  } catch (err) {
    if (err instanceof TooLargeError) throw err;
    const name = err && err.name;
    if (name === "TimeoutError" || name === "AbortError") throw new FetchTimeoutError();
    throw new FetchError(`Could not read URL body (${host})`);
  }

  if (!isHtml) {
    // Best-effort: still return a minimal record for non-HTML responses.
    const minimal = assembleContent({
      url: normalizedUrl,
      finalUrl,
      titleTag: "",
      description: "",
      h1s: [], h2s: [], h3s: [], paragraphs: [], links: [],
      contentLengthBytes: bytes,
      isHtml: false,
      images: [],
    });
    writeCache(normalizedUrl, minimal);
    return minimal;
  }

  // Extraction pipeline (contract section 3.1).
  const cleaned = stripNoise(html);
  const titleTag = extractTitleTag(html); // title lives in <head>, stripped above — read from raw.
  const description = extractMetaDescription(html);
  const h1s = extractTagTexts(cleaned, "h1", MAX_HEADINGS);
  const h2s = extractTagTexts(cleaned, "h2", MAX_HEADINGS);
  const h3s = extractTagTexts(cleaned, "h3", MAX_HEADINGS);
  const paragraphs = extractTagTexts(cleaned, "p", MAX_PARAGRAPHS)
    .map((p) => (p.length > MAX_PARAGRAPH_CHARS ? p.slice(0, MAX_PARAGRAPH_CHARS) + "…" : p));
  const links = extractLinks(cleaned, MAX_LINKS);
  const baseImages = extractImages(cleaned, MAX_IMAGES);

  const content = assembleContent({
    url: normalizedUrl,
    finalUrl,
    titleTag,
    description,
    h1s, h2s, h3s, paragraphs, links,
    contentLengthBytes: bytes,
    isHtml: true,
    images: baseImages,
  });

  // Best-effort ASCII conversion for extracted images (parallel, with timeout).
  if (baseImages.length > 0) {
    await Promise.all(baseImages.map(async (img) => {
      try {
        const ascii = await imageToAscii(img.src);
        if (ascii) img.ascii = ascii;
      } catch {
        // swallow — ascii stays undefined, frontend falls back gracefully
      }
    }));
  }

  // Enforce a total-content cap so cached records stay small.
  const serialized = JSON.stringify(content);
  if (serialized.length > MAX_TOTAL_CONTENT_CHARS * 4) {
    // Trim the largest arrays if we somehow blew the budget.
    for (const s of content.sections) {
      if (s.items && s.items.length > 5) s.items = s.items.slice(0, 5);
    }
  }

  writeCache(normalizedUrl, content);
  return content;
}

/**
 * Build an ExtractedContent-shaped record from pasted plain text (paste
 * mode for walled pages). Deterministic heuristic, same section/item
 * contract the URL pipeline produces, so the Observer loop and Stage render
 * need no special cases:
 *   - subject.name: explicit title, else the first non-empty line
 *   - subject.role: the next short non-empty line, if any
 *   - one "profile" section whose items are the text's blank-line blocks
 *     (long single blocks are re-chunked every ~15 lines)
 *
 * @param {string} text raw pasted content
 * @param {string} [title] optional explicit subject title
 * @returns {any} ExtractedContent with origin "paste"
 * @throws {UrlValidationError} when the text is too short to visit
 */
export function extractFromPlainText(text, title) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (raw.length < 80) {
    throw new UrlValidationError("Pasted text is too short — paste a real profile or page content.");
  }

  const lines = raw.split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  let name = (title || "").trim();
  if (!name) {
    name = nonEmpty[0] || "Pasted subject";
    if (name.length > 80) name = name.slice(0, 77) + "…";
  }
  // Role: the first line that isn't the name — with an explicit title that's
  // the pasted headline; without, the line after the name.
  const roleLine = nonEmpty.find((l) => l !== name && l !== title);
  const role = roleLine && roleLine.length <= 90 ? roleLine : "";

  // Split into blocks on blank lines; re-chunk monster blocks.
  let blocks = raw
    .split(/\n[ \t]*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  blocks = blocks.flatMap((b) => {
    const bl = b.split("\n");
    if (bl.length <= 18) return [b];
    const out = [];
    for (let i = 0; i < bl.length; i += 15) out.push(bl.slice(i, i + 15).join("\n").trim());
    return out.filter(Boolean);
  });
  blocks = blocks.slice(0, 12);

  const items = blocks.map((b, i) => {
    const first = b.split("\n")[0] || `Part ${i + 1}`;
    const itemTitle = first.length > 60 ? first.slice(0, 57) + "…" : first;
    const description = b.length > 600 ? b.slice(0, 600) + "…" : b;
    return { id: `part-${i + 1}`, title: itemTitle, description };
  });

  return {
    url: null,
    finalUrl: null,
    origin: "paste",
    title: name,
    description: (nonEmpty.find((l) => l !== name && l !== role) || "").slice(0, 200),
    subject: { name, role, location: null, images: [] },
    // Section ids MUST stay within the observer's fixed section set
    // (hero|about|works|career|skills — normalizeAction validates against
    // it), so the pasted blocks live under "works", titled Profile.
    sections: [
      { id: "hero", title: name, items: role ? [{ id: "headline", title: role }] : [] },
      { id: "about", title: "About", items: items.slice(0, 1) },
      { id: "works", title: "Profile", items },
    ],
    fetchedAt: new Date().toISOString(),
    contentLengthBytes: raw.length,
    isHtml: false,
    images: [],
  };
}

/**
 * Format the hostname (no path) for safe logging.
 * @param {string} url
 * @returns {string}
 */
export function hostnameForLog(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "(invalid-url)";
  }
}
