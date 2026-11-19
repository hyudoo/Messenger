import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  removeUserFromConversationRoom: vi.fn(),
  notifyBlocksChanged: vi.fn(),
  notifyContactsChanged: vi.fn(),
  notifyActivityPrivacyChanged: vi.fn(),
  callRoomSize: vi.fn(),
  markUploadsUsed: vi.fn(),
  deleteUploadedObjects: vi.fn(),
  pushNewMessage: vi.fn(),
  pushIncomingCall: vi.fn(),
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
  removeUserFromConversationRoom: mocks.removeUserFromConversationRoom,
  notifyBlocksChanged: mocks.notifyBlocksChanged,
  notifyActivityPrivacyChanged: mocks.notifyActivityPrivacyChanged,
  notifyContactsChanged: mocks.notifyContactsChanged,
  callRoomSize: mocks.callRoomSize,
}));
vi.mock("@/app/libs/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/libs/s3")>()),
  markUploadsUsed: mocks.markUploadsUsed,
  deleteUploadedObjects: mocks.deleteUploadedObjects,
}));
vi.mock("@/app/libs/message-push", () => ({
  pushNewMessage: mocks.pushNewMessage,
  pushIncomingCall: mocks.pushIncomingCall,
}));
vi.mock("bcrypt",() => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { POST as sendMessage } from "@/app/api/messages/route";
import { POST as toggleReaction } from "@/app/api/messages/[messageId]/reactions/route";
import {
  DELETE as recallMessage,
  PATCH as editMessage,
} from "@/app/api/messages/[messageId]/route";
import {
  DELETE as deleteConversation,
  PATCH as updateGroup,
} from "@/app/api/conversations/[conversationId]/route";
import {
  DELETE as removeMember,
  PATCH as setAdmin,
} from "@/app/api/conversations/[conversationId]/members/[userId]/route";
import { POST as setInvite } from "@/app/api/conversations/[conversationId]/invite/route";
import { DELETE as cancelJoinRequest, POST as joinByLink } from "@/app/api/join/[code]/route";
import { POST as answerJoinRequest } from "@/app/api/conversations/[conversationId]/join-requests/[userId]/route";
import { GET as getPrivacy, PATCH as setPrivacy } from "@/app/api/settings/privacy/route";
import { PATCH as updateSettingsOf } from "@/app/api/conversations/[conversationId]/settings/route";
import { GET as searchMessages } from "@/app/api/conversations/[conversationId]/search/route";
import { GET as searchEverywhere } from "@/app/api/search/route";
import { POST as forwardMessage } from "@/app/api/messages/[messageId]/forward/route";
import { GET as downloadFile } from "@/app/api/messages/[messageId]/download/route";
import { POST as blockUser } from "@/app/api/users/[userId]/block/route";
import { POST as requestFriend } from "@/app/api/friends/requests/route";
import {
  DELETE as cancelFriendRequest,
  POST as answerFriendRequest,
} from "@/app/api/friends/requests/[requestId]/route";
import { DELETE as unfriendUser } from "@/app/api/friends/[userId]/route";
import { GET as searchPeople } from "@/app/api/users/search/route";
import { POST as createPoll } from "@/app/api/conversations/[conversationId]/polls/route";
import { POST as votePoll } from "@/app/api/polls/[pollId]/votes/route";
import { POST as closePoll } from "@/app/api/polls/[pollId]/close/route";
import { PATCH as setNickname } from "@/app/api/conversations/[conversationId]/nicknames/route";
import { PATCH as setAppearance } from "@/app/api/conversations/[conversationId]/appearance/route";

import { POST as pinMessage } from "@/app/api/messages/[messageId]/pin/route";
import { GET as pinnedMessages } from "@/app/api/conversations/[conversationId]/pins/route";
import { POST as markSeen } from "@/app/api/conversations/[conversationId]/seen/route";
import { GET as olderMessages } from "@/app/api/conversations/[conversationId]/messages/route";
import {
  GET as listConversations,
  POST as createConversation,
} from "@/app/api/conversations/route";
import { POST as leaveConversation } from "@/app/api/conversations/[conversationId]/leave/route";
import { GET as health } from "@/app/api/health/route";
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
  mocks.callRoomSize.mockResolvedValue(0);
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

  it("sends a Web Push to the other members (a ringing one for calls)", async () => {
    asMember();
    await send({ message: "hi" });
    expect(mocks.pushNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({ id: CONVERSATION }),
        sender: me,
        body: "hi",
        recipientIds: [OTHER],
      })
    );

    mocks.pushNewMessage.mockClear();
    await send({ isCall: true, callType: "audio" });
    expect(mocks.pushNewMessage).not.toHaveBeenCalled();
    // a call gets the ringing push instead
    expect(mocks.pushIncomingCall).toHaveBeenCalledWith(
      expect.objectContaining({
        callType: "audio",
        startedAt: expect.any(Date),
        recipientIds: [OTHER],
      })
    );
  });

  it("skips the push (and marks the update) for members who muted the conversation", async () => {
    asMember();
    prisma.user.findMany.mockResolvedValue([{ id: OTHER }]);
    await send({ message: "hi" });
    expect(mocks.pushNewMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: [] }));
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      other.email,
      "conversation:update",
      expect.objectContaining({ muted: true })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      me.email,
      "conversation:update",
      expect.not.objectContaining({ muted: true })
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
    const response = await send({ message: "  Xin Chào  " });

    expect(response.status).toBe(200);
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "Xin Chào",
          searchText: "xin chao",
          senderId: ME,
          seenIds: [ME],
        }),
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

  describe("attachments", () => {
    const pdf = { kind: "file", url: uploadUrl(ME, "pdf"), name: "report.pdf", size: 1000, type: "application/pdf" };
    const voice = { kind: "voice", url: uploadUrl(ME, "webm"), name: "voice.webm", size: 1000, type: "audio/webm", duration: 4200 };

    it("saves a file or voice message after marking the upload used", async () => {
      asMember();
      expect((await send({ attachment: pdf })).status).toBe(200);
      expect(mocks.markUploadsUsed).toHaveBeenCalledWith([pdf.url]);
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attachment: pdf }) })
      );
      expect((await send({ attachment: voice })).status).toBe(200);
      expect(prisma.message.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attachment: voice }) })
      );
    });

    it.each([
      ["someone else's upload", { ...pdf, url: uploadUrl(OTHER, "pdf") }],
      ["an image URL as a file", { ...pdf, url: uploadUrl(ME, "png") }],
      ["a PDF as a voice message", { ...voice, url: uploadUrl(ME, "pdf") }],
      ["a disallowed type", { ...pdf, type: "text/html" }],
      ["a file too large", { ...pdf, size: 26 * 1024 * 1024 }],
      ["a file without a name", { ...pdf, name: "  " }],
      ["a voice message without a length", { ...voice, duration: undefined }],
      ["a voice message too long", { ...voice, duration: 10 * 60 * 1000 }],
      ["an unknown kind", { ...pdf, kind: "video" }],
    ])("rejects %s", async (_, attachment) => {
      asMember();
      expect((await send({ attachment })).status).toBe(400);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it("rejects an attachment together with an image", async () => {
      asMember();
      expect((await send({ attachment: pdf, image: uploadUrl(ME) })).status).toBe(400);
    });
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
    // the call log starts here; the socket server moves it on (server/call-log.ts)
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isCall: true, callStatus: "ringing" }),
      })
    );
  });

  it("stores and rings with the call type, video by default", async () => {
    asMember();
    await send({ isCall: true, callType: "audio" });
    await send({ isCall: true });
    const types = prisma.message.create.mock.calls.map(([args]: any) => args.data.callType);
    expect(types).toEqual(["audio", "video"]);
    const rung = mocks.emitToUser.mock.calls
      .filter(([, event]) => event === "call:incoming")
      .map(([, , payload]) => (payload as any).callType);
    expect(rung).toEqual(["audio", "video"]);
  });

  it("joins the call going on instead of ringing again", async () => {
    asMember();
    mocks.callRoomSize.mockResolvedValue(2);
    prisma.message.findFirst.mockResolvedValue({ id: "call-1", isCall: true, callStatus: "answered" });
    const res = await send({ isCall: true });
    expect(await res.json()).toMatchObject({ id: "call-1", joined: true });
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(mocks.emitToUser).not.toHaveBeenCalledWith(expect.anything(), "call:incoming", expect.anything());
  });

  it("starts a new call when the last one is over, even with someone left in the room", async () => {
    asMember();
    mocks.callRoomSize.mockResolvedValue(1);
    prisma.message.findFirst.mockResolvedValue({ id: "call-1", isCall: true, callStatus: "ended" });
    await send({ isCall: true });
    expect(prisma.message.create).toHaveBeenCalled();
  });

  it("rejects an unknown call type", async () => {
    asMember();
    expect((await send({ isCall: true, callType: "hologram" })).status).toBe(400);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("gives plain messages no call status", async () => {
    asMember();
    await send({ message: "hi" });
    const { data } = prisma.message.create.mock.calls[0][0] as any;
    expect(data.callStatus).toBeUndefined();
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

describe("POST /api/messages/[id]/reactions", () => {
  const react = (emoji: unknown, messageId = MESSAGE) =>
    toggleReaction(
      jsonRequest(`/api/messages/${messageId}/reactions`, { emoji }),
      params({ messageId })
    );

  beforeEach(() => {
    // the message lookup, then the reloaded message with its reactions
    prisma.message.findUnique.mockImplementation(async ({ include }: any) =>
      include ? { id: MESSAGE, conversationId: CONVERSATION, reactions: [] } : { conversationId: CONVERSATION }
    );
    prisma.reaction.findUnique.mockResolvedValue(null);
  });

  it("returns 404 to non-members and writes nothing", async () => {
    asNonMember();
    expect((await react("❤️")).status).toBe(404);
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
    expect(mocks.emitToConversation).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed message id", async () => {
    asMember();
    expect((await react("❤️", "not-an-id")).status).toBe(404);
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it("accepts exactly one emoji", async () => {
    asMember();
    for (const emoji of ["", "hi", "❤️❤️", "❤️ ok", 42, "😂".repeat(20)]) {
      expect((await react(emoji)).status).toBe(400);
    }
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
  });

  it("adds or replaces the caller's reaction and tells the conversation", async () => {
    asMember();
    expect((await react(" 👨‍👩‍👧 ")).status).toBe(200);
    expect(prisma.reaction.upsert).toHaveBeenCalledWith({
      where: { messageId_userId: { messageId: MESSAGE, userId: ME } },
      create: { emoji: "👨‍👩‍👧", messageId: MESSAGE, userId: ME },
      update: { emoji: "👨‍👩‍👧" },
    });
    expect(mocks.emitToConversation).toHaveBeenCalledWith(
      CONVERSATION,
      "messages:update",
      expect.objectContaining({ id: MESSAGE, reactions: [] })
    );
  });

  it("removes the reaction when the same emoji is picked again", async () => {
    asMember();
    prisma.reaction.findUnique.mockResolvedValue({ id: "r1", emoji: "❤️" });
    expect((await react("❤️")).status).toBe(200);
    expect(prisma.reaction.deleteMany).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
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

  it("signs files and voice messages by kind, with their own types and limits", async () => {
    const file = await (await ask({ contentType: "application/pdf", size: 20 * 1024 * 1024, kind: "file" })).json();
    expect(file.fileUrl).toMatch(/\.pdf$/);
    const voice = await (await ask({ contentType: "audio/webm", size: 100, kind: "voice" })).json();
    expect(voice.fileUrl).toMatch(/\.webm$/);
    // a PDF is not an image, an image is not a voice message, and no unknown kinds
    expect((await ask({ contentType: "application/pdf", size: 10 })).status).toBe(400);
    expect((await ask({ contentType: "image/png", size: 10, kind: "voice" })).status).toBe(400);
    expect((await ask({ contentType: "image/png", size: 10, kind: "html" })).status).toBe(400);
    expect((await ask({ contentType: "application/pdf", size: 26 * 1024 * 1024, kind: "file" })).status).toBe(400);
  });

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

// ---- groups: owner-only delete, leaving ----
const THIRD = "ffffffffffffffffffffffff";
const third = user(THIRD);
const group = (ownerId: string | null, users = [me, other, third]) => ({
  id: CONVERSATION,
  userIds: users.map((member) => member.id),
  users,
  isGroup: true,
  ownerId,
});

describe("DELETE /api/conversations/[id] (groups)", () => {
  const remove = () =>
    deleteConversation(
      jsonRequest(`/api/conversations/${CONVERSATION}`, null, { method: "DELETE" }),
      params({ conversationId: CONVERSATION })
    );

  it("refuses a group owned by someone else and deletes nothing", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    expect((await remove()).status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.emitToUser).not.toHaveBeenCalled();
  });

  it.each([
    ["its owner", ME],
    ["any member of a group from before owners", null],
  ])("lets %s delete it and empties the room", async (_, ownerId) => {
    prisma.conversation.findFirst.mockResolvedValue(group(ownerId));
    prisma.conversation.update.mockResolvedValue({});
    prisma.conversation.delete.mockResolvedValue({ id: CONVERSATION });

    expect((await remove()).status).toBe(200);
    expect(prisma.conversation.delete).toHaveBeenCalled();
    [me, other, third].forEach((member) =>
      expect(mocks.removeUserFromConversationRoom).toHaveBeenCalledWith(member.email, CONVERSATION)
    );
  });
});

describe("POST /api/conversations/[id]/leave", () => {
  const leave = () =>
    leaveConversation(
      jsonRequest(`/api/conversations/${CONVERSATION}/leave`, null),
      params({ conversationId: CONVERSATION })
    );

  it("returns 404 to non-members", async () => {
    asNonMember();
    expect((await leave()).status).toBe(404);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("refuses to leave a 1:1 chat", async () => {
    asMember();
    expect((await leave()).status).toBe(400);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("disconnects the caller, hands the group on and tells everyone", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(ME));
    prisma.conversation.update.mockResolvedValue(group(OTHER, [other, third]));

    expect((await leave()).status).toBe(200);

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION },
      data: { users: { disconnect: { id: ME } }, ownerId: OTHER },
      include: { users: true },
    });
    expect(mocks.emitToUser).toHaveBeenCalledWith(me.email, "conversation:remove", {
      id: CONVERSATION,
    });
    expect(mocks.removeUserFromConversationRoom).toHaveBeenCalledWith(me.email, CONVERSATION);
    [other, third].forEach((member) =>
      expect(mocks.emitToUser).toHaveBeenCalledWith(
        member.email,
        "conversation:update",
        expect.objectContaining({ id: CONVERSATION, userIds: [OTHER, THIRD], ownerId: OTHER })
      )
    );
    expect(mocks.emitToUser).not.toHaveBeenCalledWith(
      me.email,
      "conversation:update",
      expect.anything()
    );
  });

  it("keeps the owner when someone else leaves", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    prisma.conversation.update.mockResolvedValue(group(OTHER, [other, third]));

    await leave();

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { users: { disconnect: { id: ME } } } })
    );
  });

  it("deletes the group when the last member leaves", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(ME, [me]));
    prisma.conversation.update.mockResolvedValue({});
    prisma.conversation.delete.mockResolvedValue({ id: CONVERSATION });

    expect((await leave()).status).toBe(200);
    expect(prisma.conversation.delete).toHaveBeenCalled();
  });
});

describe("PATCH /api/conversations/[id] (rename, add members)", () => {
  const FOURTH = "eeeeeeeeeeeeeeeeeeeeeeee";
  const fourth = user(FOURTH);
  const patch = (body: Record<string, unknown>) =>
    updateGroup(
      jsonRequest(`/api/conversations/${CONVERSATION}`, body, { method: "PATCH" }),
      params({ conversationId: CONVERSATION })
    );

  it("returns 404 to non-members and 400 for a 1:1 chat", async () => {
    asNonMember();
    expect((await patch({ name: "x" })).status).toBe(404);
    asMember();
    expect((await patch({ name: "x" })).status).toBe(400);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it.each([[{ name: "   " }], [{ name: "x".repeat(101) }], [{}], [{ addUserIds: [OTHER] }]])(
    "refuses %j",
    async (body) => {
      prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
      expect((await patch(body)).status).toBe(400);
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    }
  );

  it("refuses unknown users", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    prisma.user.count.mockResolvedValue(0);
    expect((await patch({ addUserIds: [FOURTH] })).status).toBe(400);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("renames the group for any member and tells everyone", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    prisma.conversation.update.mockResolvedValue({ ...group(OTHER), name: "New" });

    expect((await patch({ name: "  New " })).status).toBe(200);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION },
      data: { name: "New" },
      include: { users: true },
    });
    [me, other, third].forEach((member) =>
      expect(mocks.emitToUser).toHaveBeenCalledWith(
        member.email,
        "conversation:update",
        expect.objectContaining({ id: CONVERSATION, name: "New" })
      )
    );
  });

  it("adds people: the members get the new list, the new ones the conversation", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    prisma.user.count.mockResolvedValue(1);
    prisma.conversation.update.mockResolvedValue(group(OTHER, [me, other, third, fourth]));

    expect((await patch({ addUserIds: [FOURTH, FOURTH, ME, "nope"] })).status).toBe(200);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION },
      data: { users: { connect: [{ id: FOURTH }] } },
      include: { users: true },
    });
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      fourth.email,
      "conversation:new",
      expect.objectContaining({ id: CONVERSATION, messages: [], unreadCount: 0 })
    );
    expect(mocks.emitToUser).not.toHaveBeenCalledWith(
      fourth.email,
      "conversation:update",
      expect.anything()
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      me.email,
      "conversation:update",
      expect.objectContaining({ userIds: [ME, OTHER, THIRD, FOURTH] })
    );
  });
});

describe("DELETE /api/conversations/[id]/members/[userId]", () => {
  const kick = (userId: string) =>
    removeMember(
      jsonRequest(`/api/conversations/${CONVERSATION}/members/${userId}`, null, {
        method: "DELETE",
      }),
      params({ conversationId: CONVERSATION, userId })
    );

  it("lets only the owner remove someone else", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    expect((await kick(THIRD)).status).toBe(403);
    prisma.conversation.findFirst.mockResolvedValue(group(ME));
    expect((await kick(ME)).status).toBe(403); // leaving is its own route
    expect((await kick("eeeeeeeeeeeeeeeeeeeeeeee")).status).toBe(404);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("removes the member and tells both sides", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(ME));
    prisma.conversation.update.mockResolvedValue(group(ME, [me, other]));

    expect((await kick(THIRD)).status).toBe(200);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION },
      data: { users: { disconnect: { id: THIRD } } },
      include: { users: true },
    });
    expect(mocks.emitToUser).toHaveBeenCalledWith(third.email, "conversation:remove", {
      id: CONVERSATION,
    });
    expect(mocks.removeUserFromConversationRoom).toHaveBeenCalledWith(third.email, CONVERSATION);
    [me, other].forEach((member) =>
      expect(mocks.emitToUser).toHaveBeenCalledWith(
        member.email,
        "conversation:update",
        expect.objectContaining({ userIds: [ME, OTHER] })
      )
    );
  });
});

describe("group events (system messages)", () => {
  const FOURTH = "eeeeeeeeeeeeeeeeeeeeeeee";
  const fourth = user(FOURTH);
  const event = (data: Record<string, unknown>) => ({ id: MESSAGE, createdAt: new Date(), ...data });
  const systemCreate = () =>
    prisma.message.create.mock.calls.map(([args]) => (args as { data: Record<string, unknown> }).data);
  const patch = (body: Record<string, unknown>) =>
    updateGroup(
      jsonRequest(`/api/conversations/${CONVERSATION}`, body, { method: "PATCH" }),
      params({ conversationId: CONVERSATION })
    );

  beforeEach(() => {
    prisma.message.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => event(data));
  });

  it("posts one when a group is created", async () => {
    prisma.user.count.mockResolvedValue(2);
    prisma.conversation.create.mockResolvedValue({ ...group(ME), name: "Team" });
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });

    const response = await createConversation(
      jsonRequest("/api/conversations", {
        isGroup: true,
        name: "Team",
        members: [{ value: OTHER }, { value: THIRD }],
      })
    );
    expect(response.status).toBe(200);
    expect(systemCreate()).toEqual([
      expect.objectContaining({ systemType: "created", systemName: "Team", senderId: ME, seenIds: [ME] }),
    ]);
    expect(mocks.emitToConversation).toHaveBeenCalledWith(
      CONVERSATION,
      "messages:new",
      expect.objectContaining({ systemType: "created" })
    );
  });

  it("posts renamed and added; the people added have it as read and as their preview", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(OTHER), name: "Old" });
    prisma.user.count.mockResolvedValue(1);
    prisma.conversation.update.mockResolvedValue({
      ...group(OTHER, [me, other, third, fourth]),
      name: "New",
      lastMessageAt: new Date(),
    });

    expect((await patch({ name: "New", addUserIds: [FOURTH] })).status).toBe(200);
    expect(systemCreate()).toEqual([
      expect.objectContaining({ systemType: "renamed", systemName: "New", seenIds: [ME] }),
      expect.objectContaining({
        systemType: "added",
        systemUsers: [{ id: FOURTH, name: fourth.name, email: fourth.email }],
        seenIds: [ME, FOURTH],
      }),
    ]);
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      fourth.email,
      "conversation:new",
      expect.objectContaining({ messages: [expect.objectContaining({ systemType: "added" })] })
    );
  });

  it("posts nothing for a rename to the same name", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(OTHER), name: "Same" });
    prisma.conversation.update.mockResolvedValue({ ...group(OTHER), name: "Same" });
    expect((await patch({ name: "Same" })).status).toBe(200);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("posts removed (by the owner) and left", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(ME));
    prisma.conversation.update.mockResolvedValue(group(ME, [me, other]));
    await removeMember(
      jsonRequest(`/api/conversations/${CONVERSATION}/members/${THIRD}`, null, { method: "DELETE" }),
      params({ conversationId: CONVERSATION, userId: THIRD })
    );
    prisma.conversation.update.mockResolvedValue(group(OTHER, [other, third]));
    await leaveConversation(
      jsonRequest(`/api/conversations/${CONVERSATION}/leave`, null),
      params({ conversationId: CONVERSATION })
    );

    expect(systemCreate()).toEqual([
      expect.objectContaining({
        systemType: "removed",
        senderId: ME,
        systemUsers: [{ id: THIRD, name: third.name, email: third.email }],
      }),
      expect.objectContaining({ systemType: "left", senderId: ME }),
    ]);
  });

  it("keeps the change when the event can't be posted", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(OTHER), name: "Old" });
    prisma.conversation.update.mockResolvedValue({ ...group(OTHER), name: "New" });
    prisma.message.create.mockRejectedValue(new Error("db down"));
    expect((await patch({ name: "New" })).status).toBe(200);
  });
});

describe("GET /api/conversations/[id]/messages (after / latest)", () => {
  const get = (query: string) =>
    olderMessages(
      jsonRequest(`/api/conversations/${CONVERSATION}/messages${query}`, null, {
        method: "GET",
      }),
      params({ conversationId: CONVERSATION })
    );

  it("returns the messages after the cursor, oldest first", async () => {
    asMember();
    prisma.message.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);

    const body = await (await get(`?after=${MESSAGE}`)).json();

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: MESSAGE },
        skip: 1,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    );
    expect(body).toEqual({ messages: [{ id: "m1" }, { id: "m2" }], hasMore: false });
  });

  it("returns the latest page without a cursor", async () => {
    asMember();
    prisma.message.findMany.mockResolvedValue([{ id: "m2" }, { id: "m1" }]);

    const body = await (await get("")).json();

    expect(prisma.message.findMany.mock.calls[0][0]).not.toHaveProperty("cursor");
    expect(body.messages.map((message: { id: string }) => message.id)).toEqual(["m1", "m2"]);
  });

  it("rejects before and after together", async () => {
    asMember();
    expect((await get(`?before=${MESSAGE}&after=${MESSAGE}`)).status).toBe(400);
  });
});

describe("PATCH /api/conversations/[id]/settings (mute, pin)", () => {
  const change = (body: Record<string, unknown>) =>
    updateSettingsOf(
      jsonRequest(`/api/conversations/${CONVERSATION}/settings`, body, { method: "PATCH" }),
      params({ conversationId: CONVERSATION })
    );
  const own = (muted: string[] = [], pinned: string[] = [], archived: string[] = []) =>
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      mutedConversationIds: muted,
      pinnedConversationIds: pinned,
      archivedConversationIds: archived,
    });

  it("returns 404 to non-members and 400 for nothing to change", async () => {
    asNonMember();
    expect((await change({ muted: true })).status).toBe(404);
    asMember();
    expect((await change({})).status).toBe(400);
    expect((await change({ muted: "yes" })).status).toBe(400);
  });

  it("mutes and pins for the caller only, and tells their other tabs", async () => {
    asMember();
    own(["eeeeeeeeeeeeeeeeeeeeeeee"]);
    const body = await (await change({ muted: true, pinned: true })).json();
    expect(body).toEqual({ id: CONVERSATION, muted: true, pinned: true, archived: false });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: {
        mutedConversationIds: ["eeeeeeeeeeeeeeeeeeeeeeee", CONVERSATION],
        pinnedConversationIds: [CONVERSATION],
        archivedConversationIds: [],
      },
      select: { id: true },
    });
    expect(mocks.emitToUser).toHaveBeenCalledWith(me.email, "conversation:settings", body);
  });

  it("unmutes, and refuses a sixth pin", async () => {
    asMember();
    own([CONVERSATION]);
    expect(await (await change({ muted: false })).json()).toEqual(
      expect.objectContaining({ muted: false })
    );
    own([], ["1", "2", "3", "4", "5"].map((n) => n.repeat(24)));
    expect((await change({ pinned: true })).status).toBe(409);
  });

  it("archives and unarchives", async () => {
    asMember();
    own();
    expect((await change({ archived: "yes" })).status).toBe(400);
    expect(await (await change({ archived: true })).json()).toEqual(
      expect.objectContaining({ archived: true })
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ archivedConversationIds: [CONVERSATION] }),
      })
    );
    own([], [], [CONVERSATION]);
    expect(await (await change({ archived: false })).json()).toEqual(
      expect.objectContaining({ archived: false })
    );
  });
});

describe("GET /api/conversations/[id]/search", () => {
  const search = (q: string) =>
    searchMessages(
      jsonRequest(`/api/conversations/${CONVERSATION}/search?q=${encodeURIComponent(q)}`, null, {
        method: "GET",
      }),
      params({ conversationId: CONVERSATION })
    );

  it("returns 404 to non-members and 400 for an empty or long query", async () => {
    asNonMember();
    expect((await search("hi")).status).toBe(404);
    asMember();
    expect((await search("  ")).status).toBe(400);
    expect((await search("x".repeat(101))).status).toBe(400);
  });

  it("searches the folded text (no case or diacritics), newest first", async () => {
    asMember();
    // the first lookup: the messages the user hid for themselves (none)
    prisma.message.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: MESSAGE, body: "Chào" }]);
    expect(await (await search(" CHÀO ")).json()).toEqual([{ id: MESSAGE, body: "Chào" }]);
    const { where, take } = prisma.message.findMany.mock.calls[1][0];
    expect(take).toBe(30);
    expect(where.conversationId).toEqual({ in: [CONVERSATION] });
    expect(where.id).toBeUndefined();
    expect(where.AND[2]).toEqual({
      OR: [
        { searchText: { contains: "chao" } },
        // messages from before searchText: the body, case-insensitive
        { searchText: { isSet: false }, body: { contains: "CHÀO", mode: "insensitive" } },
      ],
    });
  });
});

describe("GET /api/search (every conversation)", () => {
  const search = (q: string) =>
    searchEverywhere(jsonRequest(`/api/search?q=${encodeURIComponent(q)}`, null, { method: "GET" }));
  const GROUP_ID = "abababababababababababab";

  it("refuses an empty or long query", async () => {
    expect((await search(" ")).status).toBe(400);
    expect((await search("x".repeat(101))).status).toBe(400);
  });

  it("searches the user's conversations, without hidden messages, with each one's title", async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: CONVERSATION, name: null, isGroup: false, users: [me, other] },
      { id: GROUP_ID, name: "Team", isGroup: true, users: [me, other] },
    ]);
    const sender = { name: other.name, email: other.email, image: null };
    prisma.message.findMany
      // the user hid one message for themselves
      .mockResolvedValueOnce([{ id: "hidden" }])
      .mockResolvedValueOnce([
        { id: MESSAGE, body: "chào", createdAt: new Date(0), conversationId: GROUP_ID, sender },
        { id: "m2", body: "Chào bạn", createdAt: new Date(0), conversationId: CONVERSATION, sender },
      ]);

    const body = await (await search("chao")).json();

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userIds: { has: ME } } })
    );
    const hiddenLookup = prisma.message.findMany.mock.calls[0][0];
    expect(hiddenLookup.where).toEqual({
      conversationId: { in: [CONVERSATION, GROUP_ID] },
      hiddenForIds: { has: ME },
    });
    const { where } = prisma.message.findMany.mock.calls[1][0];
    expect(where.conversationId).toEqual({ in: [CONVERSATION, GROUP_ID] });
    expect(where.id).toEqual({ notIn: ["hidden"] });
    // a group shows its name, a 1:1 chat the other person's
    expect(body.map((result: { conversation: unknown }) => result.conversation)).toEqual([
      { id: GROUP_ID, isGroup: true, title: "Team" },
      { id: CONVERSATION, isGroup: false, title: other.name },
    ]);
    expect(body[0]).not.toHaveProperty("conversationId");
  });

  it("finds nothing without conversations", async () => {
    prisma.conversation.findMany.mockResolvedValue([]);
    expect(await (await search("chao")).json()).toEqual([]);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});

describe("mentions", () => {
  const send = (body: Record<string, unknown>) =>
    sendMessage(jsonRequest("/api/messages", { conversationId: CONVERSATION, ...body }));

  it("stores a group message's mentions; they get through a mute, with their own push", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(ME));
    // both others muted the group
    prisma.user.findMany.mockResolvedValue([{ id: OTHER }, { id: THIRD }]);
    prisma.message.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: MESSAGE,
      createdAt: new Date(),
      ...data,
    }));
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });

    expect((await send({ message: `hi @${other.name}!` })).status).toBe(200);
    const mention = { id: OTHER, name: other.name, email: other.email };
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mentions: [mention] }) })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      other.email,
      "conversation:update",
      expect.objectContaining({ mentioned: true })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      other.email,
      "conversation:update",
      expect.not.objectContaining({ muted: true })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      third.email,
      "conversation:update",
      expect.objectContaining({ muted: true })
    );
    expect(mocks.pushNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: [OTHER], mentionedIds: [OTHER] })
    );
  });

  it("has none in a 1:1 chat", async () => {
    asMember();
    await send({ message: `@${other.name} hi` });
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mentions: [] }) })
    );
  });
});

describe("blocking", () => {
  const block = (userId: string, blocked: unknown) =>
    blockUser(jsonRequest(`/api/users/${userId}/block`, { blocked }), params({ userId }));

  it("validates the request", async () => {
    expect((await block(ME, true)).status).toBe(400);
    expect((await block(OTHER, "yes")).status).toBe(400);
    prisma.user.findUnique.mockResolvedValue(null);
    expect((await block(OTHER, true)).status).toBe(404);
  });

  it("blocks and unblocks, telling both sides", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: OTHER, email: other.email });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ blockedUserIds: [] });
    expect((await block(OTHER, true)).status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { blockedUserIds: [OTHER] },
      select: { id: true },
    });
    expect(mocks.notifyBlocksChanged).toHaveBeenCalledWith([me.email, other.email]);

    prisma.user.findUniqueOrThrow.mockResolvedValue({ blockedUserIds: [OTHER] });
    await block(OTHER, false);
    expect(prisma.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { blockedUserIds: [] } })
    );
  });

  it("refuses messages and calls in a blocked 1:1 chat, either way", async () => {
    asMember();
    prisma.user.count.mockResolvedValue(1);
    const send = (body: Record<string, unknown>) =>
      sendMessage(jsonRequest("/api/messages", { conversationId: CONVERSATION, ...body }));
    expect((await send({ message: "hi" })).status).toBe(403);
    expect((await send({ isCall: true })).status).toBe(403);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { id: ME, blockedUserIds: { has: OTHER } },
          { id: OTHER, blockedUserIds: { has: ME } },
        ],
      },
    });
  });

  it("doesn't touch groups", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(ME));
    prisma.user.count.mockResolvedValue(1);
    prisma.message.create.mockResolvedValue({ id: MESSAGE, createdAt: new Date() });
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });
    const response = await sendMessage(
      jsonRequest("/api/messages", { conversationId: CONVERSATION, message: "hi" })
    );
    expect(response.status).toBe(200);
  });

  it("hides a block partner's last active time in the inbox", async () => {
    const seen = new Date();
    prisma.conversation.findMany.mockResolvedValue([
      { id: CONVERSATION, messages: [], users: [{ ...me, lastSeenAt: seen }, { ...other, lastSeenAt: seen }] },
    ]);
    // the user blocked OTHER
    prisma.user.findUnique.mockResolvedValue({
      blockedUserIds: [OTHER],
      mutedConversationIds: [],
      pinnedConversationIds: [],
      archivedConversationIds: [],
    });
    prisma.user.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.id ? [{ id: OTHER, email: other.email }] : []
    );
    const [item] = await (await listConversations()).json();
    expect(item.users.map((user: { lastSeenAt: string | null }) => user.lastSeenAt)).toEqual([
      seen.toISOString(),
      null,
    ]);
  });
});

describe("pinning messages", () => {
  const pin = (pinned: unknown) =>
    pinMessage(jsonRequest(`/api/messages/${MESSAGE}/pin`, { pinned }), params({ messageId: MESSAGE }));
  const stored = (extra: Record<string, unknown> = {}) =>
    prisma.message.findUnique.mockResolvedValue({
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderId: OTHER,
      body: "hi",
      ...extra,
    });

  it("validates, and refuses non-members, calls and a 21st pin", async () => {
    expect((await pin("yes")).status).toBe(400);
    stored();
    asNonMember();
    expect((await pin(true)).status).toBe(404);
    stored({ isCall: true });
    asMember();
    expect((await pin(true)).status).toBe(400);
    stored();
    prisma.conversation.findFirst.mockResolvedValue({
      ...conversation,
      pinnedMessageIds: Array.from({ length: 20 }, (_, i) => String(i).padStart(24, "e")),
    });
    expect((await pin(true)).status).toBe(409);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("pins first in the list, tells the chat and posts the event; unpins", async () => {
    stored();
    prisma.conversation.findFirst.mockResolvedValue({ ...conversation, pinnedMessageIds: ["x".repeat(24)] });
    prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });

    expect(await (await pin(true)).json()).toEqual({
      conversationId: CONVERSATION,
      pinnedMessageIds: [MESSAGE, "x".repeat(24)],
    });
    expect(mocks.emitToConversation).toHaveBeenCalledWith(CONVERSATION, "pins:update", {
      conversationId: CONVERSATION,
      pinnedMessageIds: [MESSAGE, "x".repeat(24)],
    });
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ systemType: "pinned" }) })
    );

    prisma.message.create.mockClear();
    prisma.conversation.findFirst.mockResolvedValue({ ...conversation, pinnedMessageIds: [MESSAGE] });
    expect(await (await pin(false)).json()).toEqual(
      expect.objectContaining({ pinnedMessageIds: [] })
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("lists the pinned messages in pin order", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...conversation, pinnedMessageIds: ["b", "a"] });
    prisma.message.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const response = await pinnedMessages(
      jsonRequest(`/api/conversations/${CONVERSATION}/pins`, null, { method: "GET" }),
      params({ conversationId: CONVERSATION })
    );
    expect(await response.json()).toEqual([{ id: "b" }, { id: "a" }]);
  });
});

describe("deleting a message for oneself", () => {
  const hide = () =>
    recallMessage(
      jsonRequest(`/api/messages/${MESSAGE}?scope=me`, null, { method: "DELETE" }),
      params({ messageId: MESSAGE })
    );

  it("hides any message for the caller only and tells their tabs", async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderId: OTHER,
      body: "hi",
    });
    asMember();
    expect((await hide()).status).toBe(200);
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: MESSAGE },
      data: { hiddenForIds: { push: ME } },
      select: { id: true },
    });
    expect(mocks.emitToUser).toHaveBeenCalledWith(me.email, "messages:hide", {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
    });
    // not recalled for the others
    expect(mocks.emitToConversation).not.toHaveBeenCalled();
  });

  it("refuses group events", async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderId: OTHER,
      systemType: "added",
    });
    asMember();
    expect((await hide()).status).toBe(400);
  });

  it("leaves hidden messages out of the pages, by id", async () => {
    asMember();
    // the viewer's hidden ones are looked up first (a positive `has`: NOT has would also drop
    // every message without the list, i.e. nearly all on MongoDB)
    prisma.message.findMany.mockResolvedValueOnce([{ id: "hidden" }]).mockResolvedValue([]);
    await olderMessages(
      jsonRequest(`/api/conversations/${CONVERSATION}/messages?before=${MESSAGE}`, null, { method: "GET" }),
      params({ conversationId: CONVERSATION })
    );
    expect(prisma.message.findMany).toHaveBeenNthCalledWith(1, {
      where: { conversationId: CONVERSATION, hiddenForIds: { has: ME } },
      select: { id: true },
    });
    expect(prisma.message.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { conversationId: CONVERSATION, id: { notIn: ["hidden"] } },
      })
    );
  });

  it("filters nothing when the viewer hid nothing", async () => {
    asMember();
    await olderMessages(
      jsonRequest(`/api/conversations/${CONVERSATION}/messages?before=${MESSAGE}`, null, { method: "GET" }),
      params({ conversationId: CONVERSATION })
    );
    expect(prisma.message.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { conversationId: CONVERSATION } })
    );
  });
});

describe("GET /api/messages/[id]/download", () => {
  const download = () =>
    downloadFile(
      jsonRequest(`/api/messages/${MESSAGE}/download`, null, { method: "GET" }),
      params({ messageId: MESSAGE })
    );
  const file = {
    kind: "file",
    url: uploadUrl(ME, "pdf"),
    name: "Báo cáo \"Q4\".pdf",
    size: 3,
    type: "application/pdf",
  };

  afterEach(() => vi.unstubAllGlobals());

  it("returns 404 to non-members and for messages without a file", async () => {
    prisma.message.findUnique.mockResolvedValue({ conversationId: CONVERSATION, attachment: file });
    asNonMember();
    expect((await download()).status).toBe(404);
    prisma.message.findUnique.mockResolvedValue({ conversationId: CONVERSATION, attachment: null });
    asMember();
    expect((await download()).status).toBe(404);
  });

  it("streams the stored file under its original name", async () => {
    prisma.message.findUnique.mockResolvedValue({ conversationId: CONVERSATION, attachment: file });
    asMember();
    const fetchMock = vi.fn().mockResolvedValue(new Response("pdf", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await download();
    expect(response.status).toBe(200);
    // the URL comes from the message, never from the request
    expect(fetchMock).toHaveBeenCalledWith(file.url);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="B_o c_o _Q4_.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );
    expect(await response.text()).toBe("pdf");
  });
});

describe("POST /api/messages/[id]/forward", () => {
  const TARGET = "eeeeeeeeeeeeeeeeeeeeeeee";
  const forward = (conversationId: string = TARGET) =>
    forwardMessage(
      jsonRequest(`/api/messages/${MESSAGE}/forward`, { conversationId }),
      params({ messageId: MESSAGE })
    );
  const original = (extra: Record<string, unknown> = {}) =>
    prisma.message.findUnique.mockResolvedValue({
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderId: OTHER,
      body: "hi",
      image: null,
      attachment: null,
      createdAt: new Date(),
      ...extra,
    });
  // the caller is in both conversations
  const inBoth = () =>
    prisma.conversation.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...conversation,
      id: where.id,
    }));

  it("returns 404 unless the caller is in both conversations", async () => {
    original();
    prisma.conversation.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === CONVERSATION ? conversation : null
    );
    expect((await forward()).status).toBe(404);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a call", { isCall: true, body: null }],
    ["a recalled message", { deletedAt: new Date(), body: null }],
    ["a group event", { systemType: "added", body: null }],
  ])("refuses %s", async (_, extra) => {
    original(extra);
    inBoth();
    expect((await forward()).status).toBe(400);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("copies the content as the caller's forwarded message and delivers it", async () => {
    original({ image: uploadUrl(OTHER) });
    inBoth();
    prisma.message.create.mockResolvedValue({ id: "new", createdAt: new Date() });
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });

    expect((await forward()).status).toBe(200);
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "hi",
          image: uploadUrl(OTHER),
          forwarded: true,
          conversationId: TARGET,
          senderId: ME,
          seenIds: [ME],
        }),
      })
    );
    expect(mocks.emitToConversation).toHaveBeenCalledWith(TARGET, "messages:new", expect.anything());
  });
});

describe("GET /api/conversations", () => {
  it("returns the caller's conversations", async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: CONVERSATION, messages: [] }]);
    const response = await listConversations();
    expect(await response.json()).toEqual([
      { id: CONVERSATION, messages: [], unreadCount: 0, muted: false, pinned: false, archived: false },
    ]);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userIds: { has: ME } } })
    );
  });

  it("answers 500 on a database error (the client keeps its list)", async () => {
    prisma.conversation.findMany.mockRejectedValue(new Error("down"));
    expect((await listConversations()).status).toBe(500);
  });

  it("returns 401 when signed out", async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await listConversations()).status).toBe(401);
  });
});

describe("POST /api/conversations (group owner)", () => {
  it("makes the creator the group's owner", async () => {
    prisma.user.count.mockResolvedValue(2);
    prisma.conversation.create.mockResolvedValue(group(ME));
    await createConversation(
      jsonRequest("/api/conversations", {
        isGroup: true,
        name: "Team",
        members: [{ value: OTHER }, { value: THIRD }],
      })
    );
    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: ME }) })
    );
  });
});

describe("GET /api/health", () => {
  const io = globalThis.io;
  afterEach(() => {
    globalThis.io = io;
  });

  it("is ok when the database answers and socket.io runs", async () => {
    globalThis.io = {} as typeof globalThis.io;
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: true, socket: true });
  });

  it("is 503 when the database is down", async () => {
    globalThis.io = {} as typeof globalThis.io;
    prisma.$runCommandRaw.mockRejectedValue(new Error("down"));
    const response = await health();
    expect(response.status).toBe(503);
    expect((await response.json()).database).toBe(false);
  });

  it("is 503 without the socket server", async () => {
    globalThis.io = undefined;
    expect((await health()).status).toBe(503);
  });
});

describe("unread counts in the conversation list", () => {
  const last = (senderId: string, seenIds: string[]) => ({ id: MESSAGE, senderId, seenIds });

  it("scans only conversations whose last message is unread", async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: CONVERSATION, messages: [last(OTHER, [OTHER])] },
      { id: "eeeeeeeeeeeeeeeeeeeeeeee", messages: [last(OTHER, [OTHER, ME])] },
      { id: "ffffffffffffffffffffffff", messages: [last(ME, [ME])] },
    ]);
    // first which last messages ME deleted for themselves (none), then the one scan, newest
    // first: two unread from OTHER, then one ME has seen
    prisma.message.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { senderId: OTHER, seenIds: [OTHER] },
      { senderId: OTHER, seenIds: [OTHER] },
      { senderId: OTHER, seenIds: [OTHER, ME] },
    ]);

    const body = await (await listConversations()).json();

    expect(body.map((item: { unreadCount: number }) => item.unreadCount)).toEqual([2, 0, 0]);
    expect(prisma.message.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: CONVERSATION }, take: 100 })
    );
  });

  it("previews the newest message the user didn't delete for themselves", async () => {
    const hidden = "abababababababababababab";
    prisma.conversation.findMany.mockResolvedValue([
      { id: CONVERSATION, messages: [{ id: hidden, senderId: ME, seenIds: [ME] }] },
    ]);
    // the hidden last message, then (lastVisibleMessage) every hidden one in that chat
    prisma.message.findMany
      .mockResolvedValueOnce([{ id: hidden }])
      .mockResolvedValueOnce([{ id: hidden }]);
    prisma.message.findFirst.mockResolvedValue({ id: MESSAGE, body: "older", senderId: ME, seenIds: [ME] });

    const body = await (await listConversations()).json();

    expect(body[0].messages.map((message: { id: string }) => message.id)).toEqual([MESSAGE]);
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: CONVERSATION, id: { notIn: [hidden] } },
      })
    );
  });
});

describe("archived conversations come back with a new message", () => {
  it("pulls the conversation from everyone's archived list when a message is delivered", async () => {
    asMember();
    prisma.message.create.mockResolvedValue({ id: MESSAGE, createdAt: new Date() });
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });
    expect(
      (await sendMessage(jsonRequest("/api/messages", { conversationId: CONVERSATION, message: "hi" })))
        .status
    ).toBe(200);
    expect(prisma.$runCommandRaw).toHaveBeenCalledWith({
      update: "User",
      updates: [
        {
          q: { archivedConversationIds: { $oid: CONVERSATION } },
          u: { $pull: { archivedConversationIds: { $oid: CONVERSATION } } },
          multi: true,
        },
      ],
    });
  });
});

describe("POST /api/messages clientId", () => {
  const send = (body: Record<string, unknown>) =>
    sendMessage(jsonRequest("/api/messages", { conversationId: CONVERSATION, ...body }));

  beforeEach(() => {
    asMember();
    prisma.message.create.mockResolvedValue({ id: MESSAGE, createdAt: new Date() });
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });
  });

  it("echoes the sender's clientId in messages:new only", async () => {
    await send({ message: "hi", clientId: "local-1-0" });
    expect(mocks.emitToConversation).toHaveBeenCalledWith(
      CONVERSATION,
      "messages:new",
      expect.objectContaining({ id: MESSAGE, clientId: "local-1-0" })
    );
    // never stored
    expect(prisma.message.create.mock.calls[0][0].data).not.toHaveProperty("clientId");
  });

  it("drops a malformed clientId", async () => {
    await send({ message: "hi", clientId: "<script>" });
    expect(mocks.emitToConversation.mock.calls[0][2]).not.toHaveProperty("clientId");
  });

  it("sends the conversation's name and kind for notifications", async () => {
    await send({ message: "hi" });
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      other.email,
      "conversation:update",
      expect.objectContaining({ id: CONVERSATION, isGroup: null })
    );
  });
});

// ---- edit / recall / reply ----
describe("PATCH / DELETE /api/messages/[id]", () => {
  const own = (extra: Record<string, unknown> = {}) => ({
    id: MESSAGE,
    conversationId: CONVERSATION,
    senderId: ME,
    body: "helo",
    image: null as string | null,
    isCall: null,
    deletedAt: null,
    createdAt: new Date(),
    ...extra,
  });
  const edit = (body: unknown) =>
    editMessage(
      jsonRequest(`/api/messages/${MESSAGE}`, body, { method: "PATCH" }),
      params({ messageId: MESSAGE })
    );
  const recall = () =>
    recallMessage(
      jsonRequest(`/api/messages/${MESSAGE}`, null, { method: "DELETE" }),
      params({ messageId: MESSAGE })
    );

  beforeEach(() => {
    asMember();
    prisma.message.update.mockImplementation(async ({ data }: any) => ({ ...own(), ...data }));
    // the edited message is the conversation's last one
    prisma.message.findFirst.mockResolvedValue({ id: MESSAGE });
  });

  it("returns 404 to non-members", async () => {
    prisma.message.findUnique.mockResolvedValue(own());
    asNonMember();
    expect((await edit({ message: "hello" })).status).toBe(404);
    expect((await recall()).status).toBe(404);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it("lets only the sender edit, and only for a while", async () => {
    prisma.message.findUnique.mockResolvedValue(own({ senderId: OTHER }));
    expect((await edit({ message: "hello" })).status).toBe(403);

    prisma.message.findUnique.mockResolvedValue(
      own({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
    );
    expect((await edit({ message: "hello" })).status).toBe(403);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it("rejects an empty or unchanged text", async () => {
    prisma.message.findUnique.mockResolvedValue(own());
    expect((await edit({ message: "  " })).status).toBe(400);
    expect((await edit({ message: "helo" })).status).toBe(400);
  });

  it("edits the text, marks it edited and updates chat and inbox", async () => {
    prisma.message.findUnique.mockResolvedValue(own());

    expect((await edit({ message: " hello " })).status).toBe(200);

    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESSAGE },
        data: { body: "hello", searchText: "hello", mentions: [], editedAt: expect.any(Date) },
      })
    );
    expect(mocks.emitToConversation).toHaveBeenCalledWith(
      CONVERSATION,
      "messages:update",
      expect.objectContaining({ body: "hello" })
    );
    // the inbox preview changes without moving the conversation up
    expect(mocks.emitToUser).toHaveBeenCalledWith(other.email, "conversation:update", {
      id: CONVERSATION,
      messages: [expect.objectContaining({ body: "hello" })],
    });
  });

  it("doesn't touch the inbox when an older message is edited", async () => {
    prisma.message.findUnique.mockResolvedValue(own());
    prisma.message.findFirst.mockResolvedValue({ id: "eeeeeeeeeeeeeeeeeeeeeeee" });
    await edit({ message: "hello" });
    expect(mocks.emitToUser).not.toHaveBeenCalled();
  });

  it("refuses to recall someone else's message or a call", async () => {
    prisma.message.findUnique.mockResolvedValue(own({ senderId: OTHER }));
    expect((await recall()).status).toBe(403);
    prisma.message.findUnique.mockResolvedValue(own({ isCall: true, body: null }));
    expect((await recall()).status).toBe(403);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it("recalls: clears text, image, attachment and reactions, and removes the image from S3", async () => {
    prisma.message.findUnique.mockResolvedValue(own({ body: null, image: uploadUrl(ME) }));

    expect((await recall()).status).toBe(200);

    expect(prisma.reaction.deleteMany).toHaveBeenCalledWith({ where: { messageId: MESSAGE } });
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          body: null,
          searchText: null,
          image: null,
          attachment: { unset: true },
          linkPreview: { unset: true },
          editedAt: null,
          deletedAt: expect.any(Date),
        },
      })
    );
    expect(mocks.emitToConversation).toHaveBeenCalledWith(
      CONVERSATION,
      "messages:update",
      expect.objectContaining({ deletedAt: expect.any(Date) })
    );
    await vi.waitFor(() =>
      expect(mocks.deleteUploadedObjects).toHaveBeenCalledWith([uploadUrl(ME)])
    );
  });

  it("can't recall twice", async () => {
    prisma.message.findUnique.mockResolvedValue(own({ deletedAt: new Date() }));
    expect((await recall()).status).toBe(403);
  });
});

describe("POST /api/messages replies", () => {
  const send = (body: Record<string, unknown>) =>
    sendMessage(jsonRequest("/api/messages", { conversationId: CONVERSATION, ...body }));

  beforeEach(() => {
    asMember();
    prisma.message.create.mockImplementation(async ({ data }: any) => ({
      id: "eeeeeeeeeeeeeeeeeeeeeeee",
      createdAt: new Date(),
      ...data,
    }));
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });
  });

  it("stores the replied-to message of the same conversation", async () => {
    prisma.message.findFirst.mockResolvedValue({ id: MESSAGE });

    expect((await send({ message: "ok", replyToId: MESSAGE })).status).toBe(200);

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: MESSAGE, conversationId: CONVERSATION }),
      })
    );
    expect(prisma.message.create.mock.calls[0][0].data.replyToId).toBe(MESSAGE);
  });

  it("rejects a reply to a missing, recalled or foreign message", async () => {
    prisma.message.findFirst.mockResolvedValue(null);
    expect((await send({ message: "ok", replyToId: MESSAGE })).status).toBe(400);
    expect((await send({ message: "ok", replyToId: "nope" })).status).toBe(400);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe("reactions on a recalled message", () => {
  it("are refused", async () => {
    prisma.message.findUnique.mockResolvedValue({
      conversationId: CONVERSATION,
      deletedAt: new Date(),
    });
    asMember();
    const response = await toggleReaction(
      jsonRequest(`/api/messages/${MESSAGE}/reactions`, { emoji: "👍" }),
      params({ messageId: MESSAGE })
    );
    expect(response.status).toBe(400);
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
  });
});

describe("reactions on a call", () => {
  it("are refused", async () => {
    prisma.message.findUnique.mockResolvedValue({
      conversationId: CONVERSATION,
      deletedAt: null,
      isCall: true,
    });
    asMember();
    const response = await toggleReaction(
      jsonRequest(`/api/messages/${MESSAGE}/reactions`, { emoji: "👍" }),
      params({ messageId: MESSAGE })
    );
    expect(response.status).toBe(400);
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
  });
});

describe("rate limits on settings and new chats", () => {
  it("limits settings changes per user", async () => {
    prisma.user.update.mockResolvedValue(me);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await updateSettings(jsonRequest("/api/settings", { name: `n${i}` }))).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("limits opening chats per user", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: OTHER });
    prisma.conversation.findFirst.mockResolvedValue({ id: CONVERSATION });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push(
        (await createConversation(jsonRequest("/api/conversations", { userId: OTHER }))).status
      );
    }
    expect(statuses[19]).toBe(200);
    expect(statuses[20]).toBe(429);
  });
});

describe("group photo, admins, invite links", () => {
  const withAdmins = (ownerId: string | null, adminIds: string[], users = [me, other, third]) => ({
    ...group(ownerId, users),
    adminIds,
  });
  const patch = (body: Record<string, unknown>) =>
    updateGroup(
      jsonRequest(`/api/conversations/${CONVERSATION}`, body, { method: "PATCH" }),
      params({ conversationId: CONVERSATION })
    );

  it("sets the group photo from the caller's own upload and posts the event", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    expect((await patch({ image: uploadUrl(OTHER) })).status).toBe(400);
    expect((await patch({ image: "https://evil.example/x.png" })).status).toBe(400);
    expect(prisma.conversation.update).not.toHaveBeenCalled();

    prisma.conversation.update.mockResolvedValue({ ...group(OTHER), image: uploadUrl(ME) });
    prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });
    expect((await patch({ image: uploadUrl(ME) })).status).toBe(200);
    expect(mocks.markUploadsUsed).toHaveBeenCalledWith([uploadUrl(ME)]);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION },
      data: { image: uploadUrl(ME) },
      include: { users: true },
    });
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ systemType: "photo" }) })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      other.email,
      "conversation:update",
      expect.objectContaining({ image: uploadUrl(ME) })
    );
  });

  it("removes the photo and posts the event", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(OTHER), image: uploadUrl(OTHER) });
    prisma.conversation.update.mockResolvedValue(group(OTHER));
    expect((await patch({ image: null })).status).toBe(200);
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { image: null } })
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ systemType: "photo_removed" }) })
    );
  });

  it("posts nothing when removing a photo the group didn't have", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
    prisma.conversation.update.mockResolvedValue(group(OTHER));
    expect((await patch({ image: null })).status).toBe(200);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  describe("admins", () => {
    const admin = (userId: string, value: unknown) =>
      setAdmin(
        jsonRequest(`/api/conversations/${CONVERSATION}/members/${userId}`, { admin: value }, {
          method: "PATCH",
        }),
        params({ conversationId: CONVERSATION, userId })
      );

    it("lets only the owner change admins", async () => {
      expect((await admin(OTHER, "yes")).status).toBe(400);
      prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME]));
      expect((await admin(THIRD, true)).status).toBe(403);
      prisma.conversation.findFirst.mockResolvedValue(withAdmins(ME, []));
      expect((await admin(ME, true)).status).toBe(403);
      expect((await admin("eeeeeeeeeeeeeeeeeeeeeeee", true)).status).toBe(404);
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it("makes and unmakes an admin, telling everyone", async () => {
      prisma.conversation.findFirst.mockResolvedValue(withAdmins(ME, []));
      prisma.conversation.update.mockResolvedValue(withAdmins(ME, [OTHER]));
      prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });

      expect(await (await admin(OTHER, true)).json()).toEqual({ adminIds: [OTHER] });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION },
        data: { adminIds: { set: [OTHER] } },
        include: { users: true },
      });
      expect(mocks.emitToUser).toHaveBeenCalledWith(
        third.email,
        "conversation:update",
        expect.objectContaining({ adminIds: [OTHER] })
      );
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ systemType: "promoted" }) })
      );

      prisma.conversation.findFirst.mockResolvedValue(withAdmins(ME, [OTHER]));
      expect(await (await admin(OTHER, false)).json()).toEqual({ adminIds: [] });
      expect(prisma.message.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ systemType: "demoted" }) })
      );
    });

    it("lets an admin remove a member but not another admin or the owner", async () => {
      const kick = (userId: string) =>
        removeMember(
          jsonRequest(`/api/conversations/${CONVERSATION}/members/${userId}`, null, {
            method: "DELETE",
          }),
          params({ conversationId: CONVERSATION, userId })
        );
      prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME, THIRD]));
      expect((await kick(OTHER)).status).toBe(403);
      expect((await kick(THIRD)).status).toBe(403);

      prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME]));
      prisma.conversation.update.mockResolvedValue(withAdmins(OTHER, [ME], [me, other]));
      expect((await kick(THIRD)).status).toBe(200);
    });

    it("hands the group on to an admin when the owner leaves, and drops leavers from admins", async () => {
      const leave = () =>
        leaveConversation(
          jsonRequest(`/api/conversations/${CONVERSATION}/leave`, null),
          params({ conversationId: CONVERSATION })
        );
      prisma.conversation.findFirst.mockResolvedValue(withAdmins(ME, [THIRD]));
      prisma.conversation.update.mockResolvedValue(withAdmins(THIRD, [], [other, third]));
      await leave();
      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { users: { disconnect: { id: ME } }, ownerId: THIRD, adminIds: { set: [] } },
        })
      );

      prisma.conversation.update.mockClear();
      prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME, THIRD]));
      prisma.conversation.update.mockResolvedValue(withAdmins(OTHER, [THIRD], [other, third]));
      await leave();
      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { users: { disconnect: { id: ME } }, adminIds: { set: [THIRD] } },
        })
      );
    });
  });

  describe("invite links", () => {
    const CODE = "AbCdEfGhIjKlMn_-";
    const invite = (enabled: unknown) =>
      setInvite(
        jsonRequest(`/api/conversations/${CONVERSATION}/invite`, { enabled }),
        params({ conversationId: CONVERSATION })
      );
    const join = (code: string) =>
      joinByLink(jsonRequest(`/api/join/${code}`, null), params({ code }));

    it("lets only admins turn the link on (a new code each time) or off", async () => {
      expect((await invite("on")).status).toBe(400);
      prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, []));
      expect((await invite(true)).status).toBe(403);

      prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME]));
      prisma.conversation.update.mockImplementation(async ({ data }: any) => ({
        ...withAdmins(OTHER, [ME]),
        ...data,
      }));
      const { inviteCode } = await (await invite(true)).json();
      expect(inviteCode).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(mocks.emitToUser).toHaveBeenCalledWith(
        third.email,
        "conversation:update",
        expect.objectContaining({ inviteCode })
      );
      const second = await (await invite(true)).json();
      expect(second.inviteCode).not.toBe(inviteCode);
      expect(await (await invite(false)).json()).toEqual({ inviteCode: null, joinApproval: false });
    });

    it("refuses malformed and unknown codes without a lookup for the malformed", async () => {
      expect((await join("bad")).status).toBe(404);
      expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
      prisma.conversation.findFirst.mockResolvedValue(null);
      expect((await join(CODE)).status).toBe(404);
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { inviteCode: CODE, isGroup: true },
        include: { users: true },
      });
    });

    it("joins: the members get the new list and the event, the joiner the conversation", async () => {
      prisma.conversation.findFirst.mockResolvedValue(group(OTHER, [other, third]));
      prisma.conversation.update.mockResolvedValue(group(OTHER, [other, third, me]));
      prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });

      expect(await (await join(CODE)).json()).toEqual({ conversationId: CONVERSATION });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION },
        data: { users: { connect: { id: ME } } },
        include: { users: true },
      });
      expect(mocks.emitToUser).toHaveBeenCalledWith(
        other.email,
        "conversation:update",
        expect.objectContaining({ userIds: [OTHER, THIRD, ME] })
      );
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ systemType: "joined", senderId: ME }),
        })
      );
      expect(mocks.emitToUser).toHaveBeenCalledWith(
        me.email,
        "conversation:new",
        expect.objectContaining({ id: CONVERSATION, unreadCount: 0 })
      );
    });

    it("does nothing for a member", async () => {
      prisma.conversation.findFirst.mockResolvedValue(group(OTHER));
      expect((await join(CODE)).status).toBe(200);
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    describe("admin approval", () => {
      const answer = (userId: string, approve: unknown) =>
        answerJoinRequest(
          jsonRequest(`/api/conversations/${CONVERSATION}/join-requests/${userId}`, { approve }),
          params({ conversationId: CONVERSATION, userId })
        );
      // Conversation.joinRequestIds is omitted from rows: read with its own select
      const waitingFor = (ids: string[]) =>
        prisma.conversation.findUnique.mockResolvedValue({ joinRequestIds: ids });
      const approvalGroup = { ...group(OTHER, [other, third]), joinApproval: true };

      it("files a request instead of joining, once, and tells only the admins", async () => {
        prisma.conversation.findFirst.mockResolvedValue(approvalGroup);
        waitingFor([]);
        prisma.conversation.update.mockResolvedValue({ id: CONVERSATION });

        expect(await (await join(CODE)).json()).toEqual({ requested: true });
        expect(prisma.conversation.update).toHaveBeenCalledWith({
          where: { id: CONVERSATION },
          data: { joinRequestIds: { push: ME } },
          select: { id: true },
        });
        // OTHER owns the group; THIRD is a plain member
        expect(mocks.emitToUser).toHaveBeenCalledWith(other.email, "join-requests:update", {
          conversationId: CONVERSATION,
        });
        expect(mocks.emitToUser).not.toHaveBeenCalledWith(
          third.email,
          "join-requests:update",
          expect.anything()
        );
        expect(prisma.message.create).not.toHaveBeenCalled();

        // asking again changes nothing
        prisma.conversation.update.mockClear();
        waitingFor([ME]);
        expect(await (await join(CODE)).json()).toEqual({ requested: true });
        expect(prisma.conversation.update).not.toHaveBeenCalled();
      });

      it("lets the user take their request back", async () => {
        const cancel = () =>
          cancelJoinRequest(
            jsonRequest(`/api/join/${CODE}`, null, { method: "DELETE" }),
            params({ code: CODE })
          );
        prisma.conversation.findFirst.mockResolvedValue(approvalGroup);
        waitingFor([THIRD]);
        expect((await cancel()).status).toBe(404);

        waitingFor([THIRD, ME]);
        prisma.conversation.update.mockResolvedValue({ id: CONVERSATION });
        expect((await cancel()).status).toBe(204);
        expect(prisma.conversation.update).toHaveBeenCalledWith({
          where: { id: CONVERSATION },
          data: { joinRequestIds: { set: [THIRD] } },
          select: { id: true },
        });
        expect(mocks.emitToUser).toHaveBeenCalledWith(other.email, "join-requests:update", {
          conversationId: CONVERSATION,
        });
      });

      it("lets only admins answer, and only existing requests", async () => {
        waitingFor([THIRD]);
        prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, []));
        expect((await answer(THIRD, "yes")).status).toBe(400);
        expect((await answer(THIRD, true)).status).toBe(403);

        prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME], [me, other]));
        expect((await answer("eeeeeeeeeeeeeeeeeeeeeeee", true)).status).toBe(404);
      });

      it("approves: joins them and clears the request", async () => {
        prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME], [me, other]));
        waitingFor([THIRD]);
        prisma.user.findUnique.mockResolvedValue(third);
        prisma.conversation.update.mockResolvedValue(group(OTHER, [me, other, third]));
        prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });

        expect(await (await answer(THIRD, true)).json()).toEqual({ approved: true });
        expect(prisma.conversation.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { users: { connect: { id: THIRD } }, joinRequestIds: { set: [] } },
          })
        );
        expect(mocks.emitToUser).toHaveBeenCalledWith(
          third.email,
          "conversation:new",
          expect.objectContaining({ id: CONVERSATION })
        );
        // no member gets the list itself
        expect(mocks.emitToUser).not.toHaveBeenCalledWith(
          expect.anything(),
          "conversation:update",
          expect.objectContaining({ joinRequestIds: expect.anything() })
        );
      });

      it("declines: drops the request and tells them", async () => {
        prisma.conversation.findFirst.mockResolvedValue(withAdmins(OTHER, [ME], [me, other]));
        waitingFor([THIRD]);
        prisma.user.findUnique.mockResolvedValue(third);
        prisma.conversation.update.mockResolvedValue({ id: CONVERSATION });

        expect(await (await answer(THIRD, false)).json()).toEqual({ approved: false });
        expect(prisma.conversation.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { joinRequestIds: { set: [] } } })
        );
        expect(mocks.emitToUser).toHaveBeenCalledWith(third.email, "join:declined", {
          conversationId: CONVERSATION,
        });
        expect(prisma.message.create).not.toHaveBeenCalled();
      });
    });
  });
});

describe("friends", () => {
  const REQUEST = "eeeeeeeeeeeeeeeeeeeeeeee";
  const ask = (userId: unknown) => requestFriend(jsonRequest("/api/friends/requests", { userId }));
  const answer = (accept: unknown) =>
    answerFriendRequest(
      jsonRequest(`/api/friends/requests/${REQUEST}`, { accept }),
      params({ requestId: REQUEST })
    );
  // what the caller's / the other's friendIds hold (findUnique with a select on friendIds)
  const friendsOf = (lists: Record<string, string[]>) =>
    prisma.user.findUnique.mockImplementation(async ({ where, select }: any) =>
      select?.friendIds ? { friendIds: lists[where.id] ?? [] } : { id: where.id, email: user(where.id).email }
    );

  it("refuses itself, unknown people, and block partners", async () => {
    expect((await ask(ME)).status).toBe(400);
    expect((await ask("nope")).status).toBe(400);
    prisma.user.findUnique.mockResolvedValue(null);
    expect((await ask(OTHER)).status).toBe(404);

    friendsOf({});
    prisma.user.count.mockResolvedValue(1);
    expect((await ask(OTHER)).status).toBe(403);
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("sends a request, once, and tells both sides", async () => {
    friendsOf({});
    prisma.user.count.mockResolvedValue(0);
    prisma.friendRequest.findUnique.mockResolvedValue(null);
    prisma.friendRequest.count.mockResolvedValue(0);
    prisma.friendRequest.create.mockResolvedValue({ id: REQUEST });

    expect(await (await ask(OTHER)).json()).toEqual({ status: "requested" });
    expect(prisma.friendRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fromId: ME, toId: OTHER } })
    );
    expect(mocks.notifyContactsChanged).toHaveBeenCalledWith([me.email, other.email], true);

    // asked already: nothing new
    prisma.friendRequest.create.mockClear();
    prisma.friendRequest.findUnique.mockImplementation(async ({ where }: any) =>
      where.fromId_toId.fromId === ME ? { id: REQUEST } : null
    );
    expect(await (await ask(OTHER)).json()).toEqual({ status: "pending" });
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("accepts theirs instead when they asked first: friends on both sides", async () => {
    friendsOf({});
    prisma.user.count.mockResolvedValue(0);
    prisma.friendRequest.findUnique.mockImplementation(async ({ where }: any) =>
      where.fromId_toId.fromId === OTHER ? { id: REQUEST } : null
    );

    expect(await (await ask(OTHER)).json()).toEqual({ status: "accepted" });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ME }, data: { friendIds: { set: [OTHER] } } })
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OTHER }, data: { friendIds: { set: [ME] } } })
    );
    expect(prisma.friendRequest.deleteMany).toHaveBeenCalled();
  });

  it("lets only the recipient answer, and only the sender cancel", async () => {
    const request = (fromId: string, toId: string) => ({
      id: REQUEST,
      fromId,
      toId,
      from: { email: user(fromId).email },
      to: { email: user(toId).email },
    });
    // sent by ME: ME can't answer it, but can cancel it
    prisma.friendRequest.findUnique.mockResolvedValue(request(ME, OTHER));
    expect((await answer(true)).status).toBe(404);
    const cancelled = await cancelFriendRequest(
      jsonRequest(`/api/friends/requests/${REQUEST}`, null, { method: "DELETE" }),
      params({ requestId: REQUEST })
    );
    expect(cancelled.status).toBe(204);
    expect(prisma.friendRequest.delete).toHaveBeenCalledWith({ where: { id: REQUEST } });

    // sent to ME: declining drops it, accepting makes friends
    prisma.friendRequest.findUnique.mockResolvedValue(request(OTHER, ME));
    expect((await answer("yes")).status).toBe(400);
    expect(await (await answer(false)).json()).toEqual({ accepted: false });
    friendsOf({});
    expect(await (await answer(true)).json()).toEqual({ accepted: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OTHER }, data: { friendIds: { set: [ME] } } })
    );
    expect(mocks.notifyContactsChanged).toHaveBeenCalledWith([other.email, me.email], true);
  });

  it("unfriends both sides, only a friend", async () => {
    const unfriend = (userId: string) =>
      unfriendUser(jsonRequest(`/api/friends/${userId}`, null, { method: "DELETE" }), params({ userId }));
    friendsOf({});
    expect((await unfriend(OTHER)).status).toBe(404);

    friendsOf({ [ME]: [OTHER, THIRD], [OTHER]: [ME] });
    expect((await unfriend(OTHER)).status).toBe(204);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ME }, data: { friendIds: { set: [THIRD] } } })
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OTHER }, data: { friendIds: { set: [] } } })
    );
  });

  it("finds people by exact email or by name, without emails, never the caller or block partners", async () => {
    const find = (q: string) =>
      searchPeople(jsonRequest(`/api/users/search?q=${encodeURIComponent(q)}`, null, { method: "GET" }));
    expect((await find("a")).status).toBe(400);

    // THIRD blocked ME
    prisma.user.findUnique.mockResolvedValue({ blockedUserIds: [], friendIds: [] });
    prisma.user.findMany.mockImplementation(async ({ where }: any) =>
      where.blockedUserIds ? [{ id: THIRD, email: third.email }] : [{ id: OTHER, name: other.name, image: null }]
    );
    prisma.friendRequest.findMany.mockResolvedValue([{ fromId: OTHER, toId: ME }]);

    expect(await (await find("user")).json()).toEqual([
      { id: OTHER, name: other.name, image: null, relation: "incoming" },
    ]);
    const byName = prisma.user.findMany.mock.calls.find(([args]: any) => args.select?.name)![0];
    expect(byName.where).toEqual({
      id: { notIn: [ME, THIRD] },
      name: { contains: "user", mode: "insensitive" },
    });
    expect(byName.select).toEqual({ id: true, name: true, image: true });

    prisma.user.findMany.mockClear();
    await find(other.email!);
    const byEmail = prisma.user.findMany.mock.calls.find(([args]: any) => args.select?.name)![0];
    expect(byEmail.where.email).toEqual({ equals: other.email, mode: "insensitive" });
  });
});

describe("polls", () => {
  const POLL = "abababababababababababab";
  const post = (body: unknown) =>
    createPoll(
      jsonRequest(`/api/conversations/${CONVERSATION}/polls`, body),
      params({ conversationId: CONVERSATION })
    );
  const vote = (optionIds: unknown) =>
    votePoll(jsonRequest(`/api/polls/${POLL}/votes`, { optionIds }), params({ pollId: POLL }));
  const close = () => closePoll(jsonRequest(`/api/polls/${POLL}/close`, {}), params({ pollId: POLL }));
  // a poll in a group owned by THIRD, asked by `senderId`
  const stored = (extra: Record<string, unknown> = {}, senderId = OTHER) => ({
    id: POLL,
    options: [
      { id: "a", text: "Pho" },
      { id: "b", text: "Pizza" },
    ],
    multiple: false,
    closedAt: null,
    message: { id: MESSAGE, conversationId: CONVERSATION, senderId, deletedAt: null },
    ...extra,
  });

  it("is for groups only and needs a valid poll", async () => {
    asMember();
    expect((await post({ question: "Lunch?", options: ["Pho", "Pizza"] })).status).toBe(400);
    prisma.conversation.findFirst.mockResolvedValue(group(THIRD));
    expect((await post({ question: "Lunch?", options: ["Pho"] })).status).toBe(400);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("posts a message whose body is the question, with its poll, delivered like a message", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(THIRD));
    prisma.message.create.mockImplementation(async ({ data }: any) => ({
      id: MESSAGE,
      createdAt: new Date(),
      ...data,
    }));
    prisma.conversation.update.mockResolvedValue({ lastMessageAt: new Date() });

    expect((await post({ question: " Lunch? ", options: ["Pho", " Pizza "], multiple: true })).status).toBe(200);
    const { data } = prisma.message.create.mock.calls[0][0];
    expect(data.body).toBe("Lunch?");
    expect(data.searchText).toBe("lunch?");
    expect(data.poll.create).toEqual({
      question: "Lunch?",
      multiple: true,
      options: [
        { id: expect.stringMatching(/^[\w-]{8}$/), text: "Pho" },
        { id: expect.stringMatching(/^[\w-]{8}$/), text: "Pizza" },
      ],
    });
    expect(mocks.emitToConversation).toHaveBeenCalledWith(
      CONVERSATION,
      "messages:new",
      expect.objectContaining({ id: MESSAGE })
    );
  });

  it("replaces the caller's votes, one option unless several are allowed", async () => {
    prisma.conversation.findFirst.mockResolvedValue(group(THIRD));
    prisma.poll.findUnique.mockResolvedValue(stored());
    prisma.message.findUnique.mockResolvedValue({ id: MESSAGE });

    expect((await vote(["a", "b"])).status).toBe(400);
    expect((await vote(["zzz"])).status).toBe(400);
    expect((await vote(["b"])).status).toBe(200);
    expect(prisma.pollVote.deleteMany).toHaveBeenCalledWith({ where: { pollId: POLL, userId: ME } });
    expect(prisma.pollVote.create).toHaveBeenCalledWith({
      data: { pollId: POLL, userId: ME, optionId: "b" },
      select: { id: true },
    });
    expect(mocks.emitToConversation).toHaveBeenCalledWith(CONVERSATION, "messages:update", { id: MESSAGE });
  });

  it("refuses votes on a closed poll, and strangers", async () => {
    prisma.poll.findUnique.mockResolvedValue(stored({ closedAt: new Date() }));
    prisma.conversation.findFirst.mockResolvedValue(group(THIRD));
    expect((await vote(["a"])).status).toBe(409);
    prisma.conversation.findFirst.mockResolvedValue(null);
    expect((await vote(["a"])).status).toBe(404);
    expect(prisma.pollVote.create).not.toHaveBeenCalled();
  });

  it("is closed by whoever asked it or an admin only", async () => {
    // asked by OTHER, ME is a plain member of THIRD's group
    prisma.conversation.findFirst.mockResolvedValue(group(THIRD));
    prisma.poll.findUnique.mockResolvedValue(stored());
    expect((await close()).status).toBe(403);

    prisma.poll.findUnique.mockResolvedValue(stored({}, ME));
    prisma.message.findUnique.mockResolvedValue({ id: MESSAGE });
    expect((await close()).status).toBe(200);
    expect(prisma.poll.update).toHaveBeenCalledWith({
      where: { id: POLL },
      data: { closedAt: expect.any(Date) },
      select: { id: true },
    });
  });
});

describe("nicknames", () => {
  const nick = (body: unknown) =>
    setNickname(
      jsonRequest(`/api/conversations/${CONVERSATION}/nicknames`, body, { method: "PATCH" }),
      params({ conversationId: CONVERSATION })
    );

  it("sets a member's nickname, tells everyone and posts the event", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(THIRD), nicknames: [] });
    prisma.conversation.update.mockImplementation(async ({ data }: any) => ({
      ...group(THIRD),
      nicknames: data.nicknames.set,
    }));
    prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });

    const response = await nick({ userId: OTHER, nickname: "  Big   Bro " });
    expect(await response.json()).toEqual({ nicknames: [{ userId: OTHER, nickname: "Big Bro" }] });
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nicknames: { set: [{ userId: OTHER, nickname: "Big Bro" }] } } })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      third.email,
      "conversation:update",
      expect.objectContaining({ nicknames: [{ userId: OTHER, nickname: "Big Bro" }] })
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemType: "nickname",
          systemName: "Big Bro",
          senderId: ME,
          systemUsers: [{ id: OTHER, name: other.name, email: other.email }],
        }),
      })
    );
  });

  it("removes one with an empty value, and does nothing when unchanged", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      ...group(THIRD),
      nicknames: [{ userId: OTHER, nickname: "Big Bro" }],
    });
    prisma.conversation.update.mockImplementation(async ({ data }: any) => ({
      ...group(THIRD),
      nicknames: data.nicknames.set,
    }));
    expect((await nick({ userId: OTHER, nickname: "Big Bro" })).status).toBe(200);
    expect(prisma.conversation.update).not.toHaveBeenCalled();

    expect(await (await nick({ userId: OTHER, nickname: "" })).json()).toEqual({ nicknames: [] });
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ systemType: "nickname" }) })
    );
  });

  it("refuses non-members as targets, long nicknames and strangers", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(THIRD), nicknames: [] });
    expect((await nick({ userId: "eeeeeeeeeeeeeeeeeeeeeeee", nickname: "X" })).status).toBe(400);
    expect((await nick({ userId: OTHER, nickname: "x".repeat(41) })).status).toBe(400);
    prisma.conversation.findFirst.mockResolvedValue(null);
    expect((await nick({ userId: OTHER, nickname: "X" })).status).toBe(404);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});

describe("conversation appearance", () => {
  const patch = (body: unknown) =>
    setAppearance(
      jsonRequest(`/api/conversations/${CONVERSATION}/appearance`, body, { method: "PATCH" }),
      params({ conversationId: CONVERSATION })
    );

  it("sets the color and quick emoji, tells everyone and posts one event per change", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(THIRD), themeColor: null, quickEmoji: null });
    prisma.conversation.update.mockImplementation(async ({ data }: any) => ({ ...group(THIRD), ...data }));
    prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });

    const response = await patch({ themeColor: "violet", quickEmoji: "❤️" });
    expect(await response.json()).toEqual({ themeColor: "violet", quickEmoji: "❤️" });
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { themeColor: "violet", quickEmoji: "❤️" } })
    );
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      third.email,
      "conversation:update",
      expect.objectContaining({ themeColor: "violet", quickEmoji: "❤️" })
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ systemType: "theme", systemName: "violet", senderId: ME }),
      })
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ systemType: "quick_emoji", systemName: "❤️", senderId: ME }),
      })
    );
  });

  it("goes back to the defaults (stored as null), and does nothing when unchanged", async () => {
    const stored = { ...group(THIRD), themeColor: "rose", quickEmoji: "🔥" };
    prisma.conversation.findFirst.mockResolvedValue(stored);
    prisma.conversation.update.mockImplementation(async ({ data }: any) => ({ ...stored, ...data }));
    prisma.message.create.mockResolvedValue({ id: "event", createdAt: new Date() });

    expect((await patch({ themeColor: "rose", quickEmoji: "🔥" })).status).toBe(200);
    expect(prisma.conversation.update).not.toHaveBeenCalled();

    expect(await (await patch({ themeColor: "sky" })).json()).toEqual({ themeColor: null, quickEmoji: "🔥" });
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { themeColor: null } })
    );
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it("refuses unknown colors, anything but one emoji, empty bodies and strangers", async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...group(THIRD), themeColor: null, quickEmoji: null });
    expect((await patch({ themeColor: "#ff0000" })).status).toBe(400);
    expect((await patch({ quickEmoji: "hi" })).status).toBe(400);
    expect((await patch({ quickEmoji: "👍👍" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    prisma.conversation.findFirst.mockResolvedValue(null);
    expect((await patch({ themeColor: "violet" })).status).toBe(404);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});

describe("privacy", () => {
  const patch = (body: unknown) =>
    setPrivacy(jsonRequest("/api/settings/privacy", body, { method: "PATCH" }));
  const seen = () =>
    markSeen(
      jsonRequest(`/api/conversations/${CONVERSATION}/seen`, {}),
      params({ conversationId: CONVERSATION })
    );

  it("returns the settings and the blocked people", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ hideActivity: true, hideReadReceipts: null })
      .mockResolvedValueOnce({ blockedUserIds: [OTHER] });
    prisma.user.findMany.mockResolvedValue([{ id: OTHER, name: "B", email: other.email, image: null }]);
    expect(await (await getPrivacy()).json()).toEqual({
      hideActivity: true,
      hideReadReceipts: false,
      blocked: [{ id: OTHER, name: "B", email: other.email, image: null }],
    });
  });

  it("validates, saves and re-announces only a changed active status", async () => {
    expect((await patch({ hideActivity: "yes" })).status).toBe(400);
    prisma.user.findUnique.mockResolvedValue({ hideActivity: false, hideReadReceipts: false });
    prisma.user.update.mockResolvedValue({ hideActivity: true, hideReadReceipts: false });
    expect(await (await patch({ hideActivity: true })).json()).toEqual({
      hideActivity: true,
      hideReadReceipts: false,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { hideActivity: true },
      select: { hideActivity: true, hideReadReceipts: true },
    });
    expect(mocks.notifyActivityPrivacyChanged).toHaveBeenCalledWith(me.email, true);

    mocks.notifyActivityPrivacyChanged.mockClear();
    prisma.user.update.mockResolvedValue({ hideActivity: false, hideReadReceipts: true });
    await patch({ hideReadReceipts: true });
    expect(mocks.notifyActivityPrivacyChanged).not.toHaveBeenCalled();
  });

  it("keeps a read without a receipt private: no seen, no update to the room", async () => {
    asMember();
    prisma.user.findUnique.mockResolvedValue({ hideActivity: false, hideReadReceipts: true });
    prisma.message.findFirst.mockResolvedValue({ id: MESSAGE, seenIds: [OTHER], privateSeenIds: [] });
    prisma.message.update.mockResolvedValue({ id: MESSAGE, seen: [other] });

    expect((await seen()).status).toBe(200);
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { privateSeenIds: { push: ME } } })
    );
    expect(mocks.emitToConversation).not.toHaveBeenCalled();
    expect(mocks.emitToUser).toHaveBeenCalledWith(
      me.email,
      "conversation:update",
      expect.objectContaining({ id: CONVERSATION, read: true })
    );

    prisma.message.update.mockClear();
    prisma.message.findFirst.mockResolvedValue({ id: MESSAGE, seenIds: [], privateSeenIds: [ME] });
    await seen();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });
});
