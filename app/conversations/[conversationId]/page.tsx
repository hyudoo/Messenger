import getConversationById from "@/app/actions/getConversationById";
import getMessages from "@/app/actions/getMessages";

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

  // only loaded once membership is confirmed
  const messages = await getMessages(conversation.id);

  return (
    <div className="lg:pl-80 h-full">
      <div className="h-full flex flex-col">
        <Header conversation={conversation} />
        <Body initialMessages={messages} />
        <Form />
      </div>
    </div>
  );
};

export default ConversationId;
