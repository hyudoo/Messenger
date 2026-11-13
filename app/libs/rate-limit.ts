import { NextResponse } from "next/server";

// Fixed-window rate limiting kept in memory. Fine while the app runs as a single
// process (server.ts); several instances would need a shared store such as Redis.

interface Bucket {
  count: number;
  resetAt: number;
}

declare global {
  var rateLimitBuckets: Map<string, Bucket> | undefined;
}

// on globalThis so dev reloads of this module keep the counters
const buckets = (globalThis.rateLimitBuckets ??= new Map<string, Bucket>());
let lastSweep = 0;

export const LIMITS = {
  register: { limit: 5, windowMs: 15 * 60_000 }, // per IP
  login: { limit: 10, windowMs: 15 * 60_000 }, // per IP + email
  loginIp: { limit: 50, windowMs: 15 * 60_000 }, // per IP, any email
  message: { limit: 20, windowMs: 10_000 }, // per user
  upload: { limit: 20, windowMs: 60_000 }, // per user
} as const;

type LimitName = keyof typeof LIMITS;

// Counts one hit for `key`; returns how many seconds to wait when over the limit.
export const rateLimit = (name: LimitName, key: string) => {
  const { limit, windowMs } = LIMITS[name];
  const now = Date.now();

  if (now - lastSweep > 60_000) {
    lastSweep = now;
    buckets.forEach((bucket, bucketKey) => {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    });
  }

  const bucketKey = `${name}:${key}`;
  const bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
};

// Client IP set by server.ts from the socket (or X-Real-IP behind a trusted proxy).
// Never read X-Forwarded-For here: clients can send any value in it.
export const clientIp = (headers: Headers | Record<string, unknown> | undefined) => {
  const value =
    headers instanceof Headers ? headers.get("x-client-ip") : headers?.["x-client-ip"];
  return typeof value === "string" && value ? value : "unknown";
};

export const tooManyRequests = (retryAfter: number) =>
  new NextResponse("Too many requests", {
    status: 429,
    headers: { "Retry-After": String(retryAfter) },
  });
