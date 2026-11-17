import getConversationById from "@/app/actions/getConversationById";
import getMessages from "@/app/actions/getMessages";
import getUsers from "@/app/actions/getUsers";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { findFirstUnread } from "@/app/libs/unread";

import Header from "./components/Header";
import Body from "./components/Body";
import Form from "./components/Form";
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
  const [{ messages, hasMore }, users] = await Promise.all([
    getMessages(conversation.id),
    conversation.isGroup ? getUsers() : Promise.resolve([]),
  ]);
  // where the "new messages" divider goes (before this page's "seen" marks them read)
  const currentUser = await getCurrentUser();
  const firstUnreadId = currentUser ? findFirstUnread(messages, currentUser.id) : null;

  return (
    <div className="lg:pl-80 h-full">
      <div className="h-full flex flex-col">
        <Header conversation={conversation} users={users} />
        <Body
          initialMessages={messages}
          initialHasMore={hasMore}
          members={conversation.users}
          firstUnreadId={firstUnreadId}
        />
        <Form />
      </div>
    </div>
  );
};

export default ConversationId;
