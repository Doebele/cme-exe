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
 * Strip tags we never want content from: script, style, nav, footer, svg,
 * noscript, template, and HTML comments. Operates on a copy.
 * @param {string} html
 * @returns {string}
 */
function stripNoise(html) {
  let out = html;
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(
    /<(script|style|nav|footer|svg|noscript|template|head|iframe|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " "
  );
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
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (text) out.push(text);
  }
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
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const hrefMatch = attrs.match(/\bhref\s*=\s*"([^"]*)"/i) || attrs.match(/\bhref\s*=\s*'([^']*)'/i);
    if (!hrefMatch) continue;
    let href = decodeEntities(hrefMatch[1].trim());
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") ||
        href.startsWith("javascript:") || href.startsWith("data:")) continue;
    if (!/^(https?:\/\/|\/|\.\/|\.\.\/)/.test(href)) continue; // skip protocol-relative too
    const title = decodeEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!title) continue;
    // Skip pure image anchors (no meaningful text).
    if (/^[\s]*$/.test(title)) continue;
    out.push({ title, href });
  }
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
  const ranges = [];
  const re = new RegExp(`<table\\b[^>]*class\\s*=\\s*"[^"]*\\b${blockClass}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/table>`, "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
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
 * Decode PNG or JPEG buffer into { data: Buffer, width, height } (RGBA).
 * Returns null for unsupported formats.
 * @param {Buffer} buf
 * @param {string} format
 * @returns {{ data: Buffer, width: number, height: number } | null}
 */
function decodeImage(buf, format) {
  if (format === "png") {
    try { return PNG.sync.read(buf); } catch { return null; }
  }
  if (format === "jpeg") {
    try { return jpeg.decode(buf, { useTArray: false }); } catch { return null; }
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
        const { url: normalizedUrl } = await validateUrl(imageUrl);
        const response = await fetch(normalizedUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        });
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
 * Validate, fetch, and extract content from an external URL.
 *
 * @param {string} url
 * @param {{ ip?: string }} [opts]
 * @returns {Promise<any>} ExtractedContent
 * @throws {UrlValidationError|BlockedError|FetchTimeoutError|TooLargeError|FetchError|RateLimitError}
 */
export async function fetchAndExtract(url, opts = {}) {
  const ip = opts && typeof opts.ip === "string" ? opts.ip : "";
  enforceFetchRateLimit(ip);

  const { url: normalizedUrl, host } = await validateUrl(url);

  const cached = readCache(normalizedUrl);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err && err.name;
    if (name === "TimeoutError" || name === "AbortError") throw new FetchTimeoutError();
    throw new FetchError(`Could not fetch URL (${host})`);
  }

  if (!response.ok) {
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
      finalUrl: response.url || normalizedUrl,
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
    finalUrl: response.url || normalizedUrl,
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
