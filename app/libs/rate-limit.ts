import { NextResponse } from "next/server";
import { createClient } from "redis";

import { getRedisUrl } from "./redis-url";

// Fixed-window rate limiting. Counters live in Redis when it is configured (shared
// by every instance), otherwise in this process's memory. If Redis fails, the
// in-memory counter is used for that request so limits never block everyone.

interface Bucket {
  count: number;
  resetAt: number;
}

type RedisClient = ReturnType<typeof createClient>;

declare global {
  var rateLimitBuckets: Map<string, Bucket> | undefined;
  var rateLimitRedis: RedisClient | undefined;
}

// a Redis command slower than this falls back to memory instead of holding up the request
const REDIS_TIMEOUT_MS = 500;
let lastRedisErrorLog = 0;

// on globalThis so dev reloads of this module keep the counters / connection
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

interface LimitResult {
  ok: boolean;
  retryAfter: number; // seconds
}

// One client per process, (re)connecting in the background. Requests never wait
// for it: until it is ready, or while Redis is down, they count in memory.
// (Awaiting connect() here would hang every request while Redis is unreachable,
// since node-redis keeps retrying without settling the promise.)
const readyRedisClient = () => {
  const url = getRedisUrl();
  if (!url) {
    return null;
  }
  if (!globalThis.rateLimitRedis) {
    const client = createClient({
      url,
      // fail commands at once while disconnected instead of queueing them
      disableOfflineQueue: true,
      socket: { connectTimeout: 2000 },
    });
    client.on("error", (error) => {
      // reconnect attempts fire this repeatedly; log at most once a minute
      if (Date.now() - lastRedisErrorLog > 60_000) {
        lastRedisErrorLog = Date.now();
        console.log(error, "REDIS_RATE_LIMIT_ERROR");
      }
    });
    client.connect().catch(() => {});
    globalThis.rateLimitRedis = client;
  }
  return globalThis.rateLimitRedis.isReady ? globalThis.rateLimitRedis : null;
};

const withTimeout = <T>(promise: Promise<T>) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Redis rate limit timed out")), REDIS_TIMEOUT_MS)
    ),
  ]);

const hitMemory = (key: string, limit: number, windowMs: number): LimitResult => {
  const now = Date.now();

  if (now - lastSweep > 60_000) {
    lastSweep = now;
    buckets.forEach((bucket, bucketKey) => {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    });
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
};

const hitRedis = async (
  client: RedisClient,
  key: string,
  limit: number,
  windowMs: number
): Promise<LimitResult> => {
  const redisKey = `ratelimit:${key}`;
  const replies = await client.multi().incr(redisKey).pTTL(redisKey).exec();
  const count = Number(replies[0]);
  const ttl = Number(replies[1]);
  // first hit of a window (or a key left without expiry): start the window
  if (ttl < 0) {
    await client.pExpire(redisKey, windowMs);
  }
  if (count > limit) {
    return { ok: false, retryAfter: Math.ceil((ttl > 0 ? ttl : windowMs) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
};

// Counts one hit for `key`; `ok: false` means over the limit for `retryAfter` seconds.
export const rateLimit = async (name: LimitName, key: string): Promise<LimitResult> => {
  const { limit, windowMs } = LIMITS[name];
  const bucketKey = `${name}:${key}`;

  const client = readyRedisClient();
  if (client) {
    try {
      return await withTimeout(hitRedis(client, bucketKey, limit, windowMs));
    } catch (error) {
      console.log(error, "ERROR_RATE_LIMIT_REDIS");
    }
  }
  return hitMemory(bucketKey, limit, windowMs);
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
