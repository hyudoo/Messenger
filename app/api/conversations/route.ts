import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { emitToUser } from "@/app/libs/socket-server";
import prisma from "@/app/libs/prismadb";
import { ConversationWithUsers } from "@/app/types";

const MAX_GROUP_NAME_LENGTH = 100;
const OBJECT_ID = /^[a-f\d]{24}$/i;

const isObjectId = (value: unknown): value is string =>
  typeof value === "string" && OBJECT_ID.test(value);

const notifyMembers = (conversation: ConversationWithUsers) => {
  conversation.users.forEach((user) => {
    if (user.email) {
      emitToUser(user.email, "conversation:new", conversation);
    }
  });
};

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser?.email) {
      return new NextResponse("Unauthorized", { status: 401 });
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
      const groupName = typeof name === "string" ? name.trim() : "";

      if (
        memberIds.length < 2 ||
        !groupName ||
        groupName.length > MAX_GROUP_NAME_LENGTH
      ) {
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
          users: {
            connect: [...memberIds, currentUser.id].map((id) => ({ id })),
          },
        },
        include: {
          users: true,
        },
      });

      notifyMembers(newConversation);
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

    notifyMembers(newConversation);
    return NextResponse.json(newConversation);
  } catch (error: any) {
    console.log(error, "ERROR_CONVERSATIONS");
    return new NextResponse("Internal Error", { status: 500 });
  }
}
