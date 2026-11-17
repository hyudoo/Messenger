import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callDurationSeconds, formatCallDuration } from "@/app/libs/call";
import { getIceServers } from "@/app/libs/ice-servers";
import { validatePassword } from "@/app/libs/password";
import { LIMITS, clientIp, rateLimit } from "@/app/libs/rate-limit";
import { getRedisUrl } from "@/app/libs/redis-url";
import { createPresignedUpload, isUploadedFileUrl } from "@/app/libs/s3";
import { ME, OTHER, S3_BASE, resetRateLimits, uploadUrl } from "../helpers";

describe("validatePassword", () => {
  it.each([
    ["short", "Ab1!"],
    ["no lowercase", "ABCDEFG1!"],
    ["no uppercase", "abcdefg1!"],
    ["no digit", "Abcdefgh!"],
    ["no special character", "Abcdefg12"],
    ["over 72 characters (bcrypt limit)", `Aa1!${"x".repeat(70)}`],
  ])("rejects a password with %s", (_, password) => {
    expect(validatePassword(password)).not.toBeNull();
  });

  it("rejects non-strings", () => {
    expect(validatePassword(undefined)).not.toBeNull();
    expect(validatePassword(12345678)).not.toBeNull();
  });

  it("accepts a password that follows every rule", () => {
    expect(validatePassword("Abcdef1!")).toBeNull();
  });
});

describe("isUploadedFileUrl", () => {
  it("accepts the caller's own upload", () => {
    expect(isUploadedFileUrl(uploadUrl(ME), ME)).toBe(true);
  });

  it.each([
    ["someone else's upload", uploadUrl(OTHER)],
    ["a path traversal", `${S3_BASE}/uploads/${ME}/../${OTHER}/123e4567-e89b-12d3-a456-426614174000.png`],
    ["a non-image extension", uploadUrl(ME, "html")],
    ["another host", uploadUrl(ME).replace(S3_BASE, "https://evil.example")],
    ["a query string", `${uploadUrl(ME)}?x=1`],
    ["a key outside uploads/", `${S3_BASE}/${ME}/123e4567-e89b-12d3-a456-426614174000.png`],
    ["a non-string", 42],
  ])("rejects %s", (_, url) => {
    expect(isUploadedFileUrl(url, ME)).toBe(false);
  });
});

describe("createPresignedUpload", () => {
  it("signs content type, length and the pending tag", async () => {
    const { uploadUrl: url, headers } = await createPresignedUpload(
      `uploads/${ME}/x.png`,
      "image/png",
      1234
    );
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders")?.split(";");

    expect(signed).toEqual(
      expect.arrayContaining(["content-length", "content-type", "x-amz-tagging"])
    );
    // the tag must stay a header: S3 ignores it in the query string
    expect(new URL(url).searchParams.has("x-amz-tagging")).toBe(false);
    expect(headers).toEqual({ "Content-Type": "image/png", "x-amz-tagging": "status=pending" });
  });
});

describe("rateLimit (in memory)", () => {
  afterEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it("allows `limit` hits per window, then reports how long to wait", async () => {
    const { limit } = LIMITS.register;
    for (let i = 0; i < limit; i++) {
      expect((await rateLimit("register", "198.51.100.1")).ok).toBe(true);
    }
    const blocked = await rateLimit("register", "198.51.100.1");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts each key separately", async () => {
    for (let i = 0; i < LIMITS.register.limit + 1; i++) {
      await rateLimit("register", "198.51.100.1");
    }
    expect((await rateLimit("register", "198.51.100.2")).ok).toBe(true);
  });

  it("opens again once the window has passed", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < LIMITS.message.limit + 1; i++) {
      await rateLimit("message", ME);
    }
    expect((await rateLimit("message", ME)).ok).toBe(false);
    vi.advanceTimersByTime(LIMITS.message.windowMs + 1);
    expect((await rateLimit("message", ME)).ok).toBe(true);
  });
});

describe("getRedisUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null when nothing is configured", () => {
    expect(getRedisUrl()).toBeNull();
  });

  it("builds the URL from host, port and an encoded password", () => {
    vi.stubEnv("REDIS_HOST", "localhost");
    vi.stubEnv("REDIS_PORT", "6380");
    vi.stubEnv("REDIS_PASSWORD", "p@ss:w/rd#1");
    expect(getRedisUrl()).toBe("redis://:p%40ss%3Aw%2Frd%231@localhost:6380");
  });

  it("defaults the port and omits auth without a password", () => {
    vi.stubEnv("REDIS_HOST", "redis");
    expect(getRedisUrl()).toBe("redis://redis:6379");
  });

  it("prefers REDIS_URL when both are set", () => {
    vi.stubEnv("REDIS_HOST", "localhost");
    vi.stubEnv("REDIS_URL", "rediss://cloud:6380");
    expect(getRedisUrl()).toBe("rediss://cloud:6380");
  });
});

// needs a real Redis: TEST_REDIS_URL=redis://localhost:6390 npm test
describe.skipIf(!process.env.TEST_REDIS_URL)("rateLimit (Redis)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.rateLimitRedis?.destroy();
    globalThis.rateLimitRedis = undefined;
    resetRateLimits();
  });

  it("counts in Redis, shared by every instance", async () => {
    vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL!);
    // the client connects in the background; wait until requests use it
    await rateLimit("register", "warm-up");
    await vi.waitFor(() => expect(globalThis.rateLimitRedis?.isReady).toBe(true));
    resetRateLimits();

    const key = `test-${Date.now()}`;
    for (let i = 0; i < LIMITS.register.limit; i++) {
      expect((await rateLimit("register", key)).ok).toBe(true);
    }
    const blocked = await rateLimit("register", key);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    // nothing was counted in memory
    expect(globalThis.rateLimitBuckets?.size ?? 0).toBe(0);
  });

  it("falls back to memory at once when Redis is unreachable", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
    const started = Date.now();
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit("register", "fallback")).ok).toBe(true);
    }
    // requests must not wait on the dead connection
    expect(Date.now() - started).toBeLessThan(200);
    expect(globalThis.rateLimitBuckets?.get("register:fallback")?.count).toBe(3);
  });
});

describe("clientIp", () => {
  it("reads only the x-client-ip header set by server.ts", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6", "x-client-ip": "198.51.100.7" });
    expect(clientIp(headers)).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6" }))).toBe("unknown");
    expect(clientIp({ "x-client-ip": "198.51.100.8" })).toBe("198.51.100.8");
  });
});

describe("getIceServers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns STUN only when TURN is not configured", () => {
    vi.stubEnv("TURN_URLS", "");
    const servers = getIceServers(ME);
    expect(servers).toHaveLength(1);
    expect(servers[0].username).toBeUndefined();
  });

  it("adds TURN with credentials coturn can verify (use-auth-secret)", () => {
    vi.stubEnv("TURN_URLS", "turn:turn.example.com:3478, turns:turn.example.com:5349");
    vi.stubEnv("TURN_SECRET", "shared-secret");
    vi.stubEnv("TURN_TTL_SECONDS", "3600");

    const turn = getIceServers(ME)[1];
    const [expiry, userId] = String(turn.username).split(":");

    expect(turn.urls).toEqual(["turn:turn.example.com:3478", "turns:turn.example.com:5349"]);
    expect(userId).toBe(ME);
    expect(Number(expiry) - Date.now() / 1000).toBeCloseTo(3600, -1);
    expect(turn.credential).toBe(
      createHmac("sha1", "shared-secret").update(String(turn.username)).digest("base64")
    );
  });
});

describe("call duration", () => {
  it("is the time from answer to hang-up, from Dates or ISO strings (socket.io)", () => {
    const answered = new Date("2026-11-16T10:00:00Z");
    expect(
      callDurationSeconds({ callAnsweredAt: answered, callEndedAt: new Date("2026-11-16T10:03:25.400Z") })
    ).toBe(205);
    expect(
      callDurationSeconds({
        callAnsweredAt: "2026-11-16T10:00:00.000Z",
        callEndedAt: "2026-11-16T10:00:07.000Z",
      })
    ).toBe(7);
  });

  it("is null for a call that was never answered or hasn't ended", () => {
    expect(callDurationSeconds({ callEndedAt: new Date() })).toBeNull();
    expect(callDurationSeconds({ callAnsweredAt: new Date(), callEndedAt: null })).toBeNull();
  });

  it("formats like a phone's call log", () => {
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(7)).toBe("0:07");
    expect(formatCallDuration(205)).toBe("3:25");
    expect(formatCallDuration(3729)).toBe("1:02:09");
  });
});
