import http from "http";
import https from "https";
import dns from "dns";
import net from "net";

import { splitLinks } from "./linkify";

// Link previews (title, description, image of the first link in a message), fetched by the
// server from the page's Open Graph / <title> tags. The server fetches URLs that users chose,
// so this is SSRF-sensitive:
// - only http(s) on the default ports, no credentials in the URL;
// - every address the name resolves to is checked when connecting (a custom `lookup`), so a
//   private / loopback / link-local / metadata address is refused even through DNS rebinding;
// - redirects are followed by hand (each hop checked the same way), at most MAX_REDIRECTS;
// - short timeout, at most MAX_BYTES read, HTML only.

export type LinkPreview = {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; MessengerLinkPreview/1.0)";

// ---- addresses ----

const ipv4ToNumber = (ip: string) =>
  ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);

// same network prefix (division rather than bit operators, which are signed 32-bit in JS)
const inRange = (ip: string, base: string, bits: number) => {
  const block = 2 ** (32 - bits);
  return Math.floor(ipv4ToNumber(ip) / block) === Math.floor(ipv4ToNumber(base) / block);
};

const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast and reserved, up to 255.255.255.255
];

// True for an address on the public internet (what a preview may be fetched from).
export const isPublicAddress = (address: string): boolean => {
  const family = net.isIP(address);
  if (family === 4) {
    return !PRIVATE_V4.some(([base, bits]) => inRange(address, base, bits));
  }
  if (family === 6) {
    const ip = address.toLowerCase();
    // IPv4-mapped / -compatible: judge the IPv4 part
    const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) {
      return isPublicAddress(mapped[1]);
    }
    if (ip === "::" || ip === "::1") {
      return false;
    }
    const first = parseInt(ip.split(":")[0] || "0", 16);
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast, 64:ff9b::/96 NAT64
    if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) {
      return false;
    }
    return !ip.startsWith("64:ff9b:");
  }
  return false;
};

// dns.lookup that refuses non-public addresses (http.request calls it when connecting).
export const safeLookup: typeof dns.lookup = ((
  hostname: string,
  options: dns.LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      return callback(error, []);
    }
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || !list.every((entry) => isPublicAddress(entry.address))) {
      return callback(Object.assign(new Error(`refused address for ${hostname}`), { code: "EREFUSED" }), []);
    }
    if (options?.all) {
      return callback(null, list);
    }
    callback(null, list[0].address, list[0].family);
  });
}) as typeof dns.lookup;

// A URL a preview may be fetched from: http(s), default port, no credentials, a host name or a
// public literal address.
export const isFetchableUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) {
      return false;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return net.isIP(host) ? isPublicAddress(host) : host.includes(".") && host !== "localhost";
  } catch {
    return false;
  }
};

// ---- fetching ----

type GetOptions = {
  accept: string;
  // the response types that are read (anything else: no body)
  type: RegExp;
  maxBytes: number;
  // more than maxBytes: keep the start (a page's <head>) or give up (an image)
  truncate: boolean;
};

const PAGE: GetOptions = {
  accept: "text/html,application/xhtml+xml",
  type: /text\/html|application\/xhtml/i,
  maxBytes: MAX_BYTES,
  truncate: true,
};

const getOnce = (url: string, options: GetOptions) =>
  new Promise<{ status: number; location?: string; type: string; body: Buffer | null }>((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { "User-Agent": USER_AGENT, Accept: options.accept },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const type = String(response.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          response.resume();
          return resolve({ status, location: response.headers.location, type, body: null });
        }
        if (status !== 200 || !options.type.test(type)) {
          response.resume();
          return resolve({ status, type, body: null });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let tooBig = false;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          chunks.push(chunk);
          // the <head> is enough: stop reading big pages
          if (size >= options.maxBytes) {
            tooBig = !options.truncate && size > options.maxBytes;
            response.destroy();
          }
        });
        response.on("close", () =>
          resolve({
            status,
            type,
            body: tooBig ? null : Buffer.concat(chunks).subarray(0, options.maxBytes),
          })
        );
        response.on("error", reject);
      }
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });

// GET with every hop checked (isFetchableUrl + safeLookup), redirects followed by hand.
const fetchChecked = async (start: string, options: GetOptions) => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableUrl(url)) {
      return null;
    }
    const response = await getOnce(url, options);
    if (response.location) {
      url = new URL(response.location, url).toString();
      continue;
    }
    return response.body && response.body.length > 0
      ? { body: response.body, type: response.type, url }
      : null;
  }
  return null;
};

// The page's HTML and its final URL (after redirects), or null.
export const fetchPage = async (start: string) => {
  const page = await fetchChecked(start, PAGE);
  return page ? { html: page.body.toString("utf8"), url: page.url } : null;
};

// Raster images a preview may show (no SVG: it could carry script when opened from our origin).
const PREVIEW_IMAGE_TYPE = /^image\/(jpeg|png|gif|webp|avif)\s*(;|$)/i;
export const MAX_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024;

// A preview's image, fetched by the server (GET /api/messages/[id]/preview-image) so the linked
// site never sees the reader's IP: same checks as the page, raster images only, at most
// MAX_PREVIEW_IMAGE_BYTES. null when it can't be fetched.
export const fetchPreviewImage = async (url: string) => {
  const image = await fetchChecked(url, {
    accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
    type: PREVIEW_IMAGE_TYPE,
    maxBytes: MAX_PREVIEW_IMAGE_BYTES,
    truncate: false,
  });
  return image ? { body: image.body, type: image.type.split(";")[0].trim().toLowerCase() } : null;
};

// ---- parsing ----

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decodeEntities = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });

const clean = (value: string | undefined, max: number) => {
  const text = value ? decodeEntities(value).replace(/\s+/g, " ").trim() : "";
  return text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null;
};

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4]) : undefined;
};

// The preview from a page's <head>: Open Graph first, then Twitter cards, then <title> /
// description. null when there is nothing worth showing (no title).
export const parsePreview = (html: string, pageUrl: string): LinkPreview | null => {
  const head = html.slice(0, Math.max(html.search(/<\/head>/i), 0) || html.length);
  const meta: Record<string, string> = {};
  for (const match of Array.from(head.matchAll(/<meta\b[^>]*>/gi))) {
    const key = (attribute(match[0], "property") ?? attribute(match[0], "name"))?.toLowerCase();
    const content = attribute(match[0], "content");
    if (key && content !== undefined && !(key in meta)) {
      meta[key] = content;
    }
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  const title = clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, 200);
  if (!title) {
    return null;
  }
  let image: string | null = null;
  const rawImage = meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"];
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage.trim()), pageUrl);
      // https only: the chat is served over https, and the browser loads it, not the server
      image = resolved.protocol === "https:" ? resolved.toString() : null;
    } catch {
      image = null;
    }
  }
  return {
    url: pageUrl,
    title,
    description: clean(meta["og:description"] ?? meta["twitter:description"] ?? meta["description"], 300),
    image,
    siteName: clean(meta["og:site_name"], 100) ?? new URL(pageUrl).hostname.replace(/^www\./, ""),
  };
};

// The first http(s) link of a message's text, or null.
export const firstLink = (text: string | null | undefined) =>
  text ? (splitLinks(text).find((segment) => segment.type === "link")?.value ?? null) : null;

// recent previews by URL, so a link sent again (or forwarded) isn't fetched again
const CACHE_MS = 60 * 60 * 1000;
const CACHE_SIZE = 200;
const cache = new Map<string, { preview: LinkPreview | null; at: number }>();

// The preview of a URL (cached), or null when it can't be fetched or has nothing to show.
export const getLinkPreview = async (url: string): Promise<LinkPreview | null> => {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.preview;
  }
  let preview: LinkPreview | null = null;
  try {
    const page = await fetchPage(url);
    preview = page ? parsePreview(page.html, page.url) : null;
  } catch {
    preview = null;
  }
  if (cache.size >= CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(url, { preview, at: Date.now() });
  return preview;
};
