import { vi } from "vitest";

// Fixed ids and URLs shared by the tests.
export const ME = "aaaaaaaaaaaaaaaaaaaaaaaa";
export const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";
export const CONVERSATION = "cccccccccccccccccccccccc";
export const MESSAGE = "dddddddddddddddddddddddd";

export const S3_BASE = "https://test-bucket.s3.ap-southeast-1.amazonaws.com";
export const uploadUrl = (owner: string, ext = "png") =>
  `${S3_BASE}/uploads/${owner}/123e4567-e89b-12d3-a456-426614174000.${ext}`;

export const user = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `user-${id.slice(0, 4)}`,
  email: `${id.slice(0, 4)}@example.com`,
  image: null as string | null,
  conversationIds: [] as string[],
  seenMessageIds: [] as string[],
  ...extra,
});

// A Prisma client stand-in: every model method is a vi.fn() the test programs.
export const createPrismaMock = () => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return {
    user: model(),
    conversation: model(),
    message: model(),
    reaction: { ...model(), upsert: vi.fn(), deleteMany: vi.fn() },
    friendRequest: { ...model(), deleteMany: vi.fn() },
    poll: { ...model(), deleteMany: vi.fn() },
    pollVote: { ...model(), deleteMany: vi.fn() },
    webPushSubscription: { ...model(), upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    $runCommandRaw: vi.fn().mockResolvedValue({ ok: 1 }),
  };
};

export type PrismaMock = ReturnType<typeof createPrismaMock>;

export const jsonRequest = (
  url: string,
  body: unknown,
  { method = "POST", ip = "203.0.113.1" }: { method?: string; ip?: string } = {}
) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-client-ip": ip },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
  });

export const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});

// Rate-limit counters live on globalThis; clear them so tests don't affect each other.
export const resetRateLimits = () => globalThis.rateLimitBuckets?.clear();
