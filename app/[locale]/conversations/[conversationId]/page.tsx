import getConversationById from "@/app/actions/getConversationById";
import getMessages from "@/app/actions/getMessages";
import getUsers from "@/app/actions/getUsers";
import getCurrentUser from "@/app/actions/getCurrentUser";
import getConversationSettings from "@/app/actions/getConversationSettings";
import getBlockState from "@/app/actions/getBlockState";
import { findPinnedMessages } from "@/app/actions/getPinnedMessages";
import { findFirstUnread } from "@/app/libs/unread";

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
  const firstUnreadId = currentUser ? findFirstUnread(messages, currentUser.id) : null;

  return (
    <div className="lg:pl-80 h-full">
      <div className="h-full flex flex-col">
        <Header
          conversation={conversation}
          users={users}
          settings={settings}
          blockedByMe={block.byMe}
          blocked={blocked}
        />
        <PinnedBar conversationId={conversation.id} initialPins={pins} />
        <Body
          initialMessages={messages}
          initialHasMore={hasMore}
          members={conversation.users}
          firstUnreadId={firstUnreadId}
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
