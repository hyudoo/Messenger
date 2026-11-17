import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION, ME, OTHER, createPrismaMock, jsonRequest, resetRateLimits, user } from "../helpers";

const mocks = vi.hoisted(() => ({
  prisma: undefined as unknown as ReturnType<typeof import("../helpers").createPrismaMock>,
  currentUser: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("@/app/libs/prismadb", () => ({
  get default() {
    return mocks.prisma;
  },
}));
vi.mock("@/app/actions/getCurrentUser", () => ({ default: mocks.currentUser }));
vi.mock("web-push", () => ({
  default: { sendNotification: mocks.sendNotification, setVapidDetails: mocks.setVapidDetails },
}));

import { GET, POST, DELETE } from "@/app/api/push/route";
import { isPushEndpoint, sendPush } from "@/app/libs/web-push";
import { pushIncomingCall, pushMissedCall, pushNewMessage } from "@/app/libs/message-push";
import { CALL_RING_TIMEOUT_MS } from "@/app/libs/call";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const subscription = (endpoint = ENDPOINT) => ({
  endpoint,
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
});
const stored = (id: string, userId: string, locale = "vi") => ({
  id,
  userId,
  locale,
  endpoint: `${ENDPOINT}-${id}`,
  p256dh: "B".repeat(87),
  auth: "a".repeat(22),
});

let prisma: ReturnType<typeof createPrismaMock>;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  prisma = mocks.prisma = createPrismaMock();
  mocks.currentUser.mockResolvedValue(user(ME));
  mocks.sendNotification.mockResolvedValue({ statusCode: 201 });
  vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPushEndpoint", () => {
  it("accepts the browsers' push services", () => {
    expect(isPushEndpoint(ENDPOINT)).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
  });

  it("refuses anything else, so the server can't be made to POST elsewhere", () => {
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("https://evil.com/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("https://notify.windows.com.evil.com/x")).toBe(false);
    expect(isPushEndpoint("https://localhost/x")).toBe(false);
    expect(isPushEndpoint(42)).toBe(false);
  });
});

describe("/api/push", () => {
  it("hands out the public key (null when push isn't configured)", async () => {
    expect(await (await GET()).json()).toEqual({ publicKey: "public-key" });
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    expect(await (await GET()).json()).toEqual({ publicKey: null });
  });

  it("stores the subscription for the signed-in user, moving it over from anyone else", async () => {
    const response = await POST(
      jsonRequest("/api/push", { subscription: subscription(), locale: "en" })
    );
    expect(response.status).toBe(200);
    expect(prisma.webPushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: ENDPOINT },
      create: expect.objectContaining({ endpoint: ENDPOINT, userId: ME, locale: "en" }),
      update: expect.objectContaining({ userId: ME, locale: "en" }),
    });
  });

  it("falls back to the default locale and drops the user's oldest browsers", async () => {
    prisma.webPushSubscription.findMany.mockResolvedValue([{ id: "old" }]);
    await POST(jsonRequest("/api/push", { subscription: subscription(), locale: "fr" }));
    expect(prisma.webPushSubscription.upsert.mock.calls[0][0].create.locale).toBe("vi");
    expect(prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old"] } },
    });
  });

  it("rejects other endpoints, bad keys and anonymous users", async () => {
    const post = (body: unknown) => POST(jsonRequest("/api/push", body));
    expect((await post({ subscription: subscription("https://internal.local/x") })).status).toBe(400);
    expect(
      (await post({ subscription: { endpoint: ENDPOINT, keys: { p256dh: "x", auth: "y" } } })).status
    ).toBe(400);
    mocks.currentUser.mockResolvedValue(null);
    expect((await post({ subscription: subscription() })).status).toBe(401);
    expect(prisma.webPushSubscription.upsert).not.toHaveBeenCalled();
  });

  it("forgets only the caller's own subscription", async () => {
    const request = new Request("http://localhost/api/push", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: ENDPOINT }),
    });
    expect((await DELETE(request)).status).toBe(200);
    expect(prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: ENDPOINT, userId: ME },
    });
  });
});

describe("sendPush", () => {
  const payload = () => ({ title: "t", body: "b", tag: "x", url: "/vi", path: "/" });

  it("does nothing while VAPID keys are missing", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await sendPush([OTHER], payload);
    expect(prisma.webPushSubscription.findMany).not.toHaveBeenCalled();
  });

  it("sends to every browser and deletes the ones the push service says are gone", async () => {
    prisma.webPushSubscription.findMany.mockResolvedValue([
      stored("s1", OTHER),
      stored("s2", OTHER),
    ]);
    mocks.sendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));

    await sendPush([OTHER], payload, { topic: CONVERSATION });

    expect(prisma.webPushSubscription.findMany).toHaveBeenCalledWith({
      where: { userId: { in: [OTHER] } },
    });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
    expect(mocks.sendNotification.mock.calls[0][2]).toEqual(
      expect.objectContaining({ topic: CONVERSATION, urgency: "high" })
    );
    expect(prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s2"] } },
    });
  });

  it("never throws, whatever the push service or the database does", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prisma.webPushSubscription.findMany.mockRejectedValue(new Error("db down"));
    await expect(sendPush([OTHER], payload)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("pushNewMessage", () => {
  const sentPayloads = () =>
    mocks.sendNotification.mock.calls.map(([, body]) => JSON.parse(body as string));

  it("writes each browser's notification in its own language", async () => {
    prisma.webPushSubscription.findMany.mockResolvedValue([
      stored("s1", OTHER, "vi"),
      stored("s2", OTHER, "en"),
    ]);
    await pushNewMessage({
      conversation: { id: CONVERSATION, name: null, isGroup: null },
      sender: { name: "Huy", image: null },
      body: null,
      image: "https://bucket/x.png",
      recipientIds: [OTHER],
    });
    expect(sentPayloads()).toEqual([
      expect.objectContaining({
        title: "Huy",
        body: "Đã gửi một hình ảnh.",
        url: `/vi/conversations/${CONVERSATION}`,
        path: `/conversations/${CONVERSATION}`,
        tag: `conversation-${CONVERSATION}`,
      }),
      expect.objectContaining({ body: "Sent an image.", url: `/en/conversations/${CONVERSATION}` }),
    ]);
  });

  it("titles group messages with the group and shortens long texts", async () => {
    prisma.webPushSubscription.findMany.mockResolvedValue([stored("s1", OTHER)]);
    await pushNewMessage({
      conversation: { id: CONVERSATION, name: "Nhóm", isGroup: true },
      sender: { name: "Huy", image: "https://avatars.githubusercontent.com/u/1" },
      body: "x".repeat(500),
      image: null,
      recipientIds: [OTHER],
    });
    const [sent] = sentPayloads();
    expect(sent.title).toBe("Nhóm");
    expect(sent.body.startsWith("Huy: x")).toBe(true);
    expect(sent.body.length).toBeLessThanOrEqual(180);
    expect(sent.icon).toBe("https://avatars.githubusercontent.com/u/1");
  });
});

describe("call pushes", () => {
  const sent = () => JSON.parse(mocks.sendNotification.mock.calls[0][1] as string);
  const options = () => mocks.sendNotification.mock.calls[0][2];
  const call = {
    conversation: { id: CONVERSATION, name: null, isGroup: null },
    sender: { name: "Huy", image: null },
    recipientIds: [OTHER],
  };

  beforeEach(() => {
    prisma.webPushSubscription.findMany.mockResolvedValue([stored("s1", OTHER, "vi")]);
  });

  it("rings only while the call rings, and stays on screen until then", async () => {
    const startedAt = new Date();
    await pushIncomingCall({ ...call, callType: "audio", startedAt });
    expect(sent()).toEqual(
      expect.objectContaining({
        title: "Huy",
        body: "Cuộc gọi thoại đến",
        tag: `call-${CONVERSATION}`,
        requireInteraction: true,
        expiresAt: startedAt.getTime() + CALL_RING_TIMEOUT_MS,
        path: `/conversations/${CONVERSATION}`,
      })
    );
    expect(options()).toEqual(
      expect.objectContaining({
        TTL: CALL_RING_TIMEOUT_MS / 1000,
        topic: `call${CONVERSATION}`,
      })
    );
    expect(options().topic.length).toBeLessThanOrEqual(32);
  });

  it("replaces the ringing notification with a missed call, kept like a message", async () => {
    await pushMissedCall({ ...call, callType: null });
    expect(sent()).toEqual(
      expect.objectContaining({ body: "Cuộc gọi video nhỡ", tag: `call-${CONVERSATION}` })
    );
    expect(sent().expiresAt).toBeUndefined();
    expect(sent().requireInteraction).toBe(false);
    expect(options()).toEqual(
      expect.objectContaining({ TTL: 12 * 60 * 60, topic: `call${CONVERSATION}` })
    );
  });
});
