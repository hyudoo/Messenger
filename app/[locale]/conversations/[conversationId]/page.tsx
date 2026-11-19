import getConversationById from "@/app/actions/getConversationById";
import getMessages from "@/app/actions/getMessages";
import getUsers from "@/app/actions/getUsers";
import getCurrentUser from "@/app/actions/getCurrentUser";
import getConversationSettings from "@/app/actions/getConversationSettings";
import getBlockState from "@/app/actions/getBlockState";
import { findPinnedMessages } from "@/app/actions/getPinnedMessages";
import { findFirstUnread } from "@/app/libs/unread";
import { privacyOf } from "@/app/libs/privacy";
import { relationsWith } from "@/app/libs/friends";
import prisma from "@/app/libs/prismadb";

import Header from "./components/Header";
import Body from "./components/Body";
import Form from "./components/Form";
import BlockedNotice from "./components/BlockedNotice";
import PinnedBar from "./components/PinnedBar";
import EmptyState from "@/app/components/EmptyState";

interface IParams {
  conversationId: string;
}

const ConversationId = async ({ params }: { params: Promise<IParams> }) => {
  const { conversationId } = await params;
  // null when the conversation does not exist or the user is not a member
  const conversation = await getConversationById(conversationId);

  if (!conversation) {
    return (
      <div className="lg:pl-80 h-full">
        <div className="h-full flex flex-col">
          <EmptyState />
        </div>
      </div>
    );
  }

  // only loaded once membership is confirmed; older pages load on scroll
  // the users: people a group member may add (the drawer's picker)
  const [{ messages, hasMore }, users, settings] = await Promise.all([
    getMessages(conversation.id, undefined, (await getCurrentUser())?.id),
    conversation.isGroup ? getUsers() : Promise.resolve([]),
    getConversationSettings(conversation.id),
  ]);
  // where the "new messages" divider goes (before this page's "seen" marks them read)
  const currentUser = await getCurrentUser();
  // a 1:1 chat: the other one, and whether either blocked the other
  const other = conversation.isGroup
    ? undefined
    : conversation.users.find((user) => user.id !== currentUser?.id);
  const block = await getBlockState(other?.id);
  const pins = await findPinnedMessages(conversation.pinnedMessageIds ?? []).catch(() => []);
  const blocked = block.byMe || block.byThem;
  // 1:1: how the user stands with the other one (the drawer's "Add friend")
  const friendRelation =
    currentUser && other
      ? (await relationsWith(currentUser.id, [other.id]).catch(() => null))?.get(other.id) ?? "none"
      : "none";
  const privacy = currentUser
    ? await privacyOf(currentUser.id).catch(() => ({ hideActivity: false, hideReadReceipts: false }))
    : null;
  // someone hiding their read receipts reads into privateSeenIds (omitted from the rows), so their
  // read marker on this page needs those too
  const privatelyRead =
    currentUser && privacy?.hideReadReceipts && messages.length > 0
      ? await prisma.message
          .findMany({
            where: { id: { in: messages.map((message) => message.id) }, privateSeenIds: { has: currentUser.id } },
            select: { id: true },
          })
          .then((rows) => new Set(rows.map((row) => row.id)))
          .catch(() => new Set<string>())
      : new Set<string>();
  const firstUnreadId = currentUser
    ? findFirstUnread(
        messages.map((message) =>
          privatelyRead.has(message.id)
            ? { ...message, privateSeenIds: [currentUser.id] }
            : message
        ),
        currentUser.id
      )
    : null;

  return (
    <div className="lg:pl-80 h-full">
      <div className="h-full flex flex-col">
        <Header
          conversation={conversation}
          users={users}
          settings={settings}
          blockedByMe={block.byMe}
          blocked={blocked}
          friendRelation={friendRelation}
        />
        <PinnedBar conversationId={conversation.id} initialPins={pins} />
        <Body
          initialMessages={messages}
          initialHasMore={hasMore}
          members={conversation.users}
          nicknames={conversation.nicknames ?? []}
          isGroup={!!conversation.isGroup}
          ownerId={conversation.ownerId}
          adminIds={conversation.adminIds}
          firstUnreadId={firstUnreadId}
          // hiding one's own read receipts also hides everyone else's
          showReceipts={!privacy?.hideReadReceipts}
        />
        {blocked && other ? (
          <BlockedNotice other={other} byMe={block.byMe} />
        ) : (
          <Form members={conversation.users} isGroup={!!conversation.isGroup} />
        )}
      </div>
    </div>
  );
};

export default ConversationId;
