import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION,
  ME,
  MESSAGE,
  OTHER,
  createPrismaMock,
  jsonRequest,
  params,
  resetRateLimits,
  uploadUrl,
  user,
} from "../helpers";

// ---- mocks: database, signed-in user, socket emits, S3 calls ----
const mocks = vi.hoisted(() => ({
  prisma: undefined as unknown as ReturnType<typeof import("../helpers").createPrismaMock>,
  currentUser: vi.fn(),
  emitToUser: vi.fn(),
  emitToConversation: vi.fn(),
  markUploadsUsed: vi.fn(),
  deleteUploadedObjects: vi.fn(),
}));

vi.mock("@/app/libs/prismadb", () => ({
  get default() {
    return mocks.prisma;
  },
}));
vi.mock("@/app/actions/getCurrentUser", () => ({ default: mocks.currentUser }));
vi.mock("@/app/libs/socket-server", () => ({
  emitToUser: mocks.emitToUser,
  emitToConversation: mocks.emitToConversation,
}));
vi.mock("@/app/libs/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/libs/s3")>()),
  markUploadsUsed: mocks.markUploadsUsed,
  deleteUploadedObjects: mocks.deleteUploadedObjects,
}));
vi.mock("bcrypt", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { POST as sendMessage } from "@/app/api/messages/route";
import { DELETE as deleteConversation } from "@/app/api/conversations/[conversationId]/route";
import { POST as markSeen } from "@/app/api/conversations/[conversationId]/seen/route";
import { GET as olderMessages } from "@/app/api/conversations/[conversationId]/messages/route";
import { POST as createConversation } from "@/app/api/conversations/route";
import { POST as register } from "@/app/api/register/route";
import { POST as updateSettings } from "@/app/api/settings/route";
import { POST as requestUpload } from "@/app/api/uploads/route";

const me = user(ME);
const other = user(OTHER);
const conversation = {
  id: CONVERSATION,
  userIds: [ME, OTHER],
  users: [me, other],
  isGroup: null,
};

let prisma: ReturnType<typeof createPrismaMock>;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  prisma = mocks.prisma = createPrismaMock();
  mocks.currentUser.mockResolvedValue(me);
  mocks.markUploadsUsed.mockResolvedValue(undefined);
  mocks.deleteUploadedObjects.mockResolvedValue(undefined);
});

// the conversation lookup used for membership checks
const asMember = () => prisma.conversation.findFirst.mockResolvedValue(conversation);
const asNonMember = () => prisma.conversation.findFirst.mockResolvedValue(null);

describe("POST /api/messages", () => {
  const send = (body: Record<string, unknown>) =>
    sendMessage(jsonRequest("/api/messages", { conversationId: CONVERSATION, ...body }));

  beforeEach(() => {
    prisma.message.create.mockImplementation(async ({ data }: any) => ({
      id: MESSAGE,
      createdAt: new Date(),
      ...data,
    }));
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });
  });

  it("rejects anonymous users", async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await send({ message: "hi" })).status).toBe(401);
  });

  it("returns 404 to non-members and writes nothing", async () => {
    asNonMember();
    expect((await send({ message: "hi" })).status).toBe(404);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("checks membership with the signed-in user's id", async () => {
    asMember();
    await send({ message: "hi" });
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CONVERSATION, userIds: { has: ME } } })
    );
  });

  it("rejects empty and too long messages", async () => {
    asMember();
    expect((await send({ message: "   " })).status).toBe(400);
    expect((await send({ message: "x".repeat(5001) })).status).toBe(400);
  });

  it("rejects someone else's upload and arbitrary image URLs", async () => {
    asMember();
    expect((await send({ image: uploadUrl(OTHER) })).status).toBe(400);
    expect((await send({ image: "https://evil.example/a.png" })).status).toBe(400);
    expect(mocks.markUploadsUsed).not.toHaveBeenCalled();
  });

  it("rejects an image that was never uploaded", async () => {
    asMember();
    mocks.markUploadsUsed.mockRejectedValue(new Error("NoSuchKey"));
    expect((await send({ image: uploadUrl(ME) })).status).toBe(400);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("saves the message and notifies the conversation and every member", async () => {
    asMember();
    const response = await send({ message: "  hello  " });

    expect(response.status).toBe(200);
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: "hello", senderId: ME, seenIds: [ME] }),
      })
    );
    expect(mocks.emitToConversation).toHaveBeenCalledWith(
      CONVERSATION,
      "messages:new",
      expect.objectContaining({ id: MESSAGE })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      other.email,
      "conversation:update",
      expect.objectContaining({ id: CONVERSATION, lastMessageAt: expect.any(Date) })
    );
  });

  it("marks an image as used before saving it", async () => {
    asMember();
    expect((await send({ image: uploadUrl(ME) })).status).toBe(200);
    expect(mocks.markUploadsUsed).toHaveBeenCalledWith([uploadUrl(ME)]);
  });

  it("rings only the other members for a call", async () => {
    asMember();
    await send({ isCall: true });
    const ringed = mocks.emitToUser.mock.calls
      .filter(([, event]) => event === "call:incoming")
      .map(([email]) => email);
    expect(ringed).toEqual([other.email]);
  });

  it("rate limits a user who sends too fast", async () => {
    asMember();
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await send({ message: `m${i}` })).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("DELETE /api/conversations/[id]", () => {
  const remove = () =>
    deleteConversation(
      jsonRequest(`/api/conversations/${CONVERSATION}`, null, { method: "DELETE" }),
      params({ conversationId: CONVERSATION })
    );

  it("returns 404 to non-members, deletes nothing and notifies nobody", async () => {
    asNonMember();
    expect((await remove()).status).toBe(404);
    expect(prisma.conversation.delete).not.toHaveBeenCalled();
    expect(mocks.emitToUser).not.toHaveBeenCalled();
  });

  it("disconnects members, deletes, and cleans up afterwards", async () => {
    asMember();
    // first call: the conversation's messages; later calls (the cleanup's
    // "still referenced?" check) see them gone, as after the real delete
    prisma.message.findMany.mockResolvedValueOnce([
      { id: MESSAGE, image: uploadUrl(ME) },
      { id: "eeeeeeeeeeeeeeeeeeeeeeee", image: null },
    ]);
    prisma.conversation.update.mockResolvedValue({});
    prisma.conversation.delete.mockResolvedValue({ id: CONVERSATION });

    expect((await remove()).status).toBe(200);

    // members are disconnected in the same transaction, so User.conversationIds is updated
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION },
      data: { users: { set: [] } },
    });
    // deleted message ids are pulled from the members' seenMessageIds
    expect(prisma.$runCommandRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        update: "User",
        updates: [
          expect.objectContaining({
            q: { _id: { $in: [{ $oid: ME }, { $oid: OTHER }] } },
            u: {
              $pull: {
                seenMessageIds: {
                  $in: [{ $oid: MESSAGE }, { $oid: "eeeeeeeeeeeeeeeeeeeeeeee" }],
                },
              },
            },
          }),
        ],
      })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      other.email,
      "conversation:remove",
      expect.objectContaining({ id: CONVERSATION })
    );

    // the image is deleted from S3 in the background once nothing references it
    await vi.waitFor(() =>
      expect(mocks.deleteUploadedObjects).toHaveBeenCalledWith([uploadUrl(ME)])
    );
  });
});

describe("POST /api/conversations/[id]/seen", () => {
  it("returns 404 to non-members", async () => {
    asNonMember();
    const response = await markSeen(
      jsonRequest(`/api/conversations/${CONVERSATION}/seen`, {}),
      params({ conversationId: CONVERSATION })
    );
    expect(response.status).toBe(404);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it("does nothing when the last message is already seen", async () => {
    asMember();
    prisma.message.findFirst.mockResolvedValue({ id: MESSAGE, seenIds: [ME] });
    await markSeen(
      jsonRequest(`/api/conversations/${CONVERSATION}/seen`, {}),
      params({ conversationId: CONVERSATION })
    );
    expect(prisma.message.update).not.toHaveBeenCalled();
    expect(mocks.emitToConversation).not.toHaveBeenCalled();
  });
});

describe("GET /api/conversations/[id]/messages", () => {
  const page = (before: string) =>
    olderMessages(
      jsonRequest(`/api/conversations/${CONVERSATION}/messages?before=${before}`, null, {
        method: "GET",
      }),
      params({ conversationId: CONVERSATION })
    );

  it("returns 404 to non-members", async () => {
    asNonMember();
    expect((await page(MESSAGE)).status).toBe(404);
  });

  it("rejects a malformed cursor", async () => {
    asMember();
    expect((await page("not-an-id")).status).toBe(400);
  });

  it("returns the page before the cursor, oldest first, with hasMore", async () => {
    asMember();
    // 51 rows newest first: one more than a page, so hasMore is true
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `m${50 - i}` }));
    prisma.message.findMany.mockResolvedValue(rows);

    const body = await (await page(MESSAGE)).json();

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: MESSAGE }, skip: 1, take: 51 })
    );
    expect(body.hasMore).toBe(true);
    expect(body.messages).toHaveLength(50);
    expect(body.messages[0].id).toBe("m1");
    expect(body.messages[49].id).toBe("m50");
  });
});

describe("POST /api/conversations", () => {
  const create = (body: Record<string, unknown>) =>
    createConversation(jsonRequest("/api/conversations", body));

  it("rejects chatting with yourself or an unknown user", async () => {
    expect((await create({ userId: ME })).status).toBe(400);
    prisma.user.findUnique.mockResolvedValue(null);
    expect((await create({ userId: OTHER })).status).toBe(400);
  });

  it("rejects a group with members that don't exist", async () => {
    prisma.user.count.mockResolvedValue(1);
    const response = await create({
      isGroup: true,
      name: "Team",
      members: [{ value: OTHER }, { value: "ffffffffffffffffffffffff" }],
    });
    expect(response.status).toBe(400);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it("returns the existing 1:1 conversation instead of creating another", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: OTHER });
    prisma.conversation.findFirst.mockResolvedValue({ id: CONVERSATION });
    const body = await (await create({ userId: OTHER })).json();
    expect(body.id).toBe(CONVERSATION);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/register", () => {
  const signUp = (body: Record<string, unknown>, ip?: string) =>
    register(jsonRequest("/api/register", body, { ip }));
  const valid = { email: "new@example.com", name: "New", password: "Abcdef1!" };

  it("enforces the password rules on the server", async () => {
    expect((await signUp({ ...valid, password: "abc" })).status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 409 for an email already in use", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: OTHER });
    expect((await signUp(valid)).status).toBe(409);
  });

  it("returns only public fields", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: ME, email: valid.email, name: "New" });
    await signUp(valid);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, email: true, name: true } })
    );
  });

  it("rate limits by the IP that server.ts sets", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await signUp({ email: "bad" }, "198.51.100.9")).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    // a different client IP has its own budget
    expect((await signUp({ email: "bad" }, "198.51.100.10")).status).toBe(400);
  });
});

describe("POST /api/settings", () => {
  const save = (body: Record<string, unknown>) =>
    updateSettings(jsonRequest("/api/settings", body));

  beforeEach(() => {
    prisma.user.update.mockImplementation(async ({ data }: any) => ({ ...me, ...data }));
  });

  it("rejects someone else's upload as avatar", async () => {
    expect((await save({ name: "Me", image: uploadUrl(OTHER) })).status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("keeps the current (e.g. OAuth) avatar without touching S3", async () => {
    mocks.currentUser.mockResolvedValue({ ...me, image: "https://avatars.githubusercontent.com/u/1" });
    expect(
      (await save({ name: "Me", image: "https://avatars.githubusercontent.com/u/1" })).status
    ).toBe(200);
    expect(mocks.markUploadsUsed).not.toHaveBeenCalled();
  });

  it("keeps the old avatar on S3 while a message still uses it", async () => {
    mocks.currentUser.mockResolvedValue({ ...me, image: uploadUrl(ME, "jpg") });
    prisma.message.findMany.mockResolvedValue([{ image: uploadUrl(ME, "jpg") }]);
    expect((await save({ name: "Me", image: uploadUrl(ME) })).status).toBe(200);
    await vi.waitFor(() => expect(mocks.deleteUploadedObjects).toHaveBeenCalled());
    expect(mocks.deleteUploadedObjects).toHaveBeenCalledWith([]);
  });

  it("switches to a new upload and cleans up the old one", async () => {
    mocks.currentUser.mockResolvedValue({ ...me, image: uploadUrl(ME, "jpg") });
    expect((await save({ name: "Me", image: uploadUrl(ME) })).status).toBe(200);
    expect(mocks.markUploadsUsed).toHaveBeenCalledWith([uploadUrl(ME)]);
    await vi.waitFor(() =>
      expect(mocks.deleteUploadedObjects).toHaveBeenCalledWith([uploadUrl(ME, "jpg")])
    );
  });
});

describe("POST /api/uploads", () => {
  const ask = (body: Record<string, unknown>) => requestUpload(jsonRequest("/api/uploads", body));

  it("rejects unsupported types and sizes", async () => {
    expect((await ask({ contentType: "text/html", size: 10 })).status).toBe(400);
    expect((await ask({ contentType: "image/png", size: 11 * 1024 * 1024 })).status).toBe(400);
  });

  it("returns a URL in the user's own folder and the headers to send", async () => {
    const body = await (await ask({ contentType: "image/png", size: 100 })).json();
    expect(body.fileUrl).toMatch(new RegExp(`/uploads/${ME}/[0-9a-f-]{36}\\.png$`));
    expect(body.headers).toEqual({ "Content-Type": "image/png", "x-amz-tagging": "status=pending" });
  });
});
