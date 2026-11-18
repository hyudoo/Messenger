import { NextResponse } from "next/server";

import { findConversationsForUser } from "@/app/actions/getConversation";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { emitToUser } from "@/app/libs/socket-server";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import prisma from "@/app/libs/prismadb";
import { ConversationWithUsers } from "@/app/types";
import { logError } from "@/app/libs/log";
import { normalizeGroupName } from "@/app/libs/conversation-permissions";
import { postSystemMessage } from "@/app/libs/system-message";
import { lastSeenViewsOf } from "@/app/libs/privacy";

const OBJECT_ID = /^[a-f\d]{24}$/i;

const isObjectId = (value: unknown): value is string =>
  typeof value === "string" && OBJECT_ID.test(value);

// each member gets it with the others as they may see them (lastSeenViewsOf)
const notifyMembers = async (conversation: ConversationWithUsers) => {
  const usersFor = await lastSeenViewsOf(conversation.users);
  conversation.users.forEach((user) => {
    if (user.email) {
      emitToUser(user.email, "conversation:new", { ...conversation, users: usersFor(user.id) });
    }
  });
};

// The conversation list as the inbox shows it (same as the server-rendered one); the client reloads
// it after a socket reconnect, since events sent while it was disconnected are lost.
export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    return NextResponse.json(await findConversationsForUser(currentUser.id));
  } catch (error) {
    logError("conversations_list", error);
    return new NextResponse("Error", { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser?.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("conversation", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { userId, isGroup, members, name } = await request.json();

    if (isGroup) {
      // members come from react-select: [{ value: userId, label }]
      const memberIds: string[] = Array.from(
        new Set(
          (Array.isArray(members) ? members : [])
            .map((member: { value?: unknown }) => member?.value)
            .filter(isObjectId)
            .filter((id: string) => id !== currentUser.id)
        )
      );
      const groupName = normalizeGroupName(name);

      if (memberIds.length < 2 || !groupName) {
        return new NextResponse("Invalid data", { status: 400 });
      }
      const existingMembers = await prisma.user.count({
        where: { id: { in: memberIds } },
      });
      if (existingMembers !== memberIds.length) {
        return new NextResponse("Invalid members", { status: 400 });
      }

      const newConversation = await prisma.conversation.create({
        data: {
          name: groupName,
          isGroup: true,
          ownerId: currentUser.id,
          users: {
            connect: [...memberIds, currentUser.id].map((id) => ({ id })),
          },
        },
        include: {
          users: true,
        },
      });

      await notifyMembers(newConversation);
      // the first message: "X created the group" (also moves it to the top of the inboxes)
      await postSystemMessage({
        conversation: newConversation,
        actorId: currentUser.id,
        type: "created",
        name: groupName,
      });
      return NextResponse.json(newConversation);
    }

    if (!isObjectId(userId) || userId === currentUser.id) {
      return new NextResponse("Invalid user", { status: 400 });
    }
    const otherUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!otherUser) {
      return new NextResponse("Invalid user", { status: 400 });
    }

    const existingConversation = await prisma.conversation.findFirst({
      // groups have 3+ members, so a two-id match is always the 1:1 chat
      where: {
        OR: [
          { userIds: { equals: [currentUser.id, userId] } },
          { userIds: { equals: [userId, currentUser.id] } },
        ],
      },
    });

    if (existingConversation) {
      return NextResponse.json(existingConversation);
    }

    const newConversation = await prisma.conversation.create({
      data: {
        users: {
          connect: [{ id: currentUser.id }, { id: userId }],
        },
      },
      include: {
        users: true,
      },
    });

    await notifyMembers(newConversation);
    return NextResponse.json(newConversation);
  } catch (error: any) {
    logError("conversations", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
