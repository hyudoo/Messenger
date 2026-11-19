import bcrypt from "bcrypt";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ME,
  OTHER,
  createPrismaMock,
  resetRateLimits,
  uploadUrl,
  user,
} from "../helpers";

const mocks = vi.hoisted(() => ({
  prisma: undefined as unknown as ReturnType<typeof import("../helpers").createPrismaMock>,
  currentUser: vi.fn(),
  emitToUser: vi.fn(),
  emitToConversation: vi.fn(),
  notifyContactsChanged: vi.fn(),
  notifySessionsRevoked: vi.fn(),
  removeUserFromConversationRoom: vi.fn(),
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
  notifyContactsChanged: mocks.notifyContactsChanged,
  notifySessionsRevoked: mocks.notifySessionsRevoked,
  removeUserFromConversationRoom: mocks.removeUserFromConversationRoom,
}));
vi.mock("@/app/libs/s3", () => ({ deleteUploadedObjects: mocks.deleteUploadedObjects }));

import { DELETE as deleteAccountRoute, GET as accountInfo } from "@/app/api/account/route";

const THIRD = "eeeeeeeeeeeeeeeeeeeeeeee";
const DIRECT = "111111111111111111111111";
const GROUP = "222222222222222222222222";
const me = user(ME);
const other = user(OTHER);
const third = user(THIRD);
const avatar = uploadUrl(ME);
const photo = uploadUrl(ME, "jpg");

let prisma: ReturnType<typeof createPrismaMock>;
let storedHash: string;
const remove = (body: unknown) =>
  deleteAccountRoute(
    new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
// the raw $pull updates sent, by collection
const rawUpdates = (collection: string) =>
  prisma.$runCommandRaw.mock.calls
    .map(([command]: any) => command)
    .filter((command: any) => command.update === collection)
    .map((command: any) => command.updates[0]);

beforeAll(async () => {
  storedHash = await bcrypt.hash("Secr3t-pass", 4);
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  prisma = mocks.prisma = createPrismaMock();
  mocks.currentUser.mockResolvedValue(me);
  prisma.user.findUnique.mockImplementation(async ({ select }: any) =>
    select?.hashedPassword
      ? { hashedPassword: storedHash, email: me.email }
      : { id: ME, email: me.email, image: avatar, friendIds: [THIRD] }
  );
  const direct = { id: DIRECT, isGroup: false, userIds: [ME, OTHER], users: [me, other], image: null };
  const group = {
    id: GROUP,
    isGroup: true,
    name: "G",
    ownerId: ME,
    adminIds: [],
    userIds: [ME, OTHER, THIRD],
    users: [me, other, third],
  };
  prisma.conversation.findMany.mockImplementation(async ({ where }: any) =>
    where?.userIds ? [direct, group] : []
  );
  prisma.conversation.update.mockImplementation(async ({ where, data }: any) =>
    where.id === GROUP
      ? { ...group, ownerId: data.ownerId ?? group.ownerId, userIds: [OTHER, THIRD], users: [other, third] }
      : direct
  );
  prisma.conversation.delete.mockResolvedValue(direct);
  prisma.message.findMany.mockImplementation(async ({ where }: any) =>
    where?.senderId === ME ? [{ id: "m1", conversationId: GROUP, image: photo, attachment: null }] : []
  );
  prisma.friendRequest.findMany.mockResolvedValue([
    { from: { email: "stranger@example.com" }, to: { email: me.email } },
  ]);
  prisma.user.findMany.mockImplementation(async ({ where }: any) =>
    where?.id?.in ? [{ email: third.email }] : []
  );
  prisma.user.delete.mockResolvedValue({ id: ME });
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/account", () => {
  it("tells whether deleting is confirmed with a password", async () => {
    expect(await (await accountInfo()).json()).toEqual({ hasPassword: true });
    prisma.user.findUnique.mockResolvedValue({ hashedPassword: null });
    expect(await (await accountInfo()).json()).toEqual({ hasPassword: false });
  });
});

describe("DELETE /api/account", () => {
  it("refuses strangers and a wrong password, deleting nothing", async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await remove({ password: "x" })).status).toBe(401);
    mocks.currentUser.mockResolvedValue(me);
    const wrong = await remove({ password: "nope" });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toBe("wrong_password");
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });

  it("asks an account without a password for its email address", async () => {
    prisma.user.findUnique.mockImplementation(async ({ select }: any) =>
      select?.hashedPassword
        ? { hashedPassword: null, email: me.email }
        : { id: ME, email: me.email, image: null, friendIds: [] }
    );
    expect(await (await remove({ email: "someone@else.com" })).text()).toBe("wrong_email");
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect((await remove({ email: ` ${me.email!.toUpperCase()} ` })).status).toBe(200);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: ME } });
  });

  it("deletes 1:1 chats, leaves groups silently, removes their messages and ids, and signs them out", async () => {
    const response = await remove({ password: "Secr3t-pass" });
    expect(response.status).toBe(200);
    // this device's cookie is cleared
    expect(response.headers.get("set-cookie")).toMatch(/next-auth\.session-token=;.*Max-Age=0/i);

    // the 1:1 chat goes for both
    expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: DIRECT } });
    expect(mocks.emitToUser).toHaveBeenCalledWith(other.email, "conversation:remove", expect.anything());
    // the group: they leave, ownership passes on, no "left" event (its sender is going)
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: GROUP },
        data: expect.objectContaining({ users: { disconnect: { id: ME } }, ownerId: OTHER }),
      })
    );
    expect(prisma.message.create).not.toHaveBeenCalled();

    // their group message: replies unlinked, reactions / poll / the message deleted, open chats told
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { replyToId: { in: ["m1"] } },
      data: { replyToId: null },
    });
    expect(prisma.reaction.deleteMany).toHaveBeenCalledWith({ where: { messageId: { in: ["m1"] } } });
    expect(prisma.poll.deleteMany).toHaveBeenCalledWith({ where: { messageId: { in: ["m1"] } } });
    expect(prisma.message.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["m1"] } } });
    expect(mocks.emitToConversation).toHaveBeenCalledWith(GROUP, "messages:hide", {
      conversationId: GROUP,
      messageId: "m1",
    });

    // their id leaves everyone else's lists
    expect(rawUpdates("User")).toContainEqual(
      expect.objectContaining({ u: { $pull: { friendIds: { $oid: ME }, blockedUserIds: { $oid: ME } } } })
    );
    expect(rawUpdates("Message")).toContainEqual(
      expect.objectContaining({
        u: { $pull: { seenIds: { $oid: ME }, privateSeenIds: { $oid: ME }, hiddenForIds: { $oid: ME } } },
      })
    );
    expect(rawUpdates("Conversation")).toContainEqual(
      expect.objectContaining({
        u: {
          $pull: { adminIds: { $oid: ME }, joinRequestIds: { $oid: ME }, nicknames: { userId: { $oid: ME } } },
        },
      })
    );

    // the user row last, then sessions and contacts
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: ME } });
    expect(prisma.user.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      prisma.message.deleteMany.mock.invocationCallOrder[0]
    );
    expect(mocks.notifySessionsRevoked).toHaveBeenCalledWith(ME, me.email);
    expect(mocks.notifyContactsChanged).toHaveBeenCalledWith(
      expect.arrayContaining([other.email, third.email, "stranger@example.com"]),
      true
    );
    expect(mocks.notifyContactsChanged.mock.calls.at(-1)?.[0]).not.toContain(me.email);

    // their files go once nothing else uses them
    await vi.waitFor(() =>
      expect(mocks.deleteUploadedObjects).toHaveBeenCalledWith(expect.arrayContaining([avatar, photo]))
    );
  });

  it("is rate limited with password changes", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await remove({ password: "nope" })).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
