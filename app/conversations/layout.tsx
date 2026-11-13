import getConversations from "../actions/getConversation";
import getUsers from "../actions/getUsers";
import Sidebar from "../components/sidebar/Sidebar";
import ConversationList from "./components/ConversationList";

export default async function ConversationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [conversation, users] = await Promise.all([
    getConversations(),
    getUsers(),
  ]);

  return (
    <Sidebar>
      <div className="h-full">
        <ConversationList users={users} initialItems={conversation} />
        {children}
      </div>
    </Sidebar>
  );
}
