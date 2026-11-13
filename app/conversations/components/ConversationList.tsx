"use client";

import { SafeUser } from "@/app/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MdOutlineGroupAdd } from "react-icons/md";
import clsx from "clsx";
import { find } from "lodash";

import useConversation from "@/app/hooks/useConversation";
import { getSocket } from "@/app/libs/socket-client";
import GroupChatModal from "@/app/components/modals/GroupChatModal";
import ConversationBox from "./ConversationBox";
import { FullConversationType, FullCallType } from "@/app/types";
import IncomingCallModal from "@/app/components/modals/IncomingCallModal";

interface ConversationListProps {
  initialItems: FullConversationType[];
  users: SafeUser[];
}

const ConversationList: React.FC<ConversationListProps> = ({
  initialItems,
  users,
}) => {
  const [items, setItems] = useState(initialItems);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCallOpen, setIsCallOpen] = useState(false);
  const [otherUser, setOtherUser] = useState<SafeUser>();
  const [roomId, setRoomId] = useState<String>();

  const router = useRouter();

  const { conversationId, isOpen } = useConversation();

  // The server puts every socket in its user's room on connect, so these
  // per-user events need no explicit subscription.
  useEffect(() => {
    const socket = getSocket();

    const newHandler = (conversation: FullConversationType) => {
      setItems((current) => {
        if (find(current, { id: conversation.id })) {
          return current;
        }
        return [conversation, ...current];
      });
    };

    // A new message also carries lastMessageAt: that conversation moves to the top.
    // "Seen" updates don't, so the order stays put.
    const updateHandler = (
      conversation: Pick<FullConversationType, "id" | "messages"> & {
        lastMessageAt?: string;
      }
    ) => {
      setItems((current) => {
        const target = current.find((item) => item.id === conversation.id);
        if (!target) {
          return current;
        }
        const updated = {
          ...target,
          messages: conversation.messages,
          ...(conversation.lastMessageAt && {
            lastMessageAt: new Date(conversation.lastMessageAt),
          }),
        };
        if (!conversation.lastMessageAt) {
          return current.map((item) => (item.id === updated.id ? updated : item));
        }
        return [updated, ...current.filter((item) => item.id !== updated.id)];
      });
    };

    const removeHandler = (conversation: FullConversationType) => {
      setItems((current) => {
        return [...current.filter((convo) => convo.id !== conversation.id)];
      });
      if (conversationId === conversation.id) {
        router.push("/conversations");
      }
    };

    const incomingCallHandler = (call: FullCallType) => {
      setOtherUser(call.user);
      setRoomId(call.id);
      setIsCallOpen(true);
    };

    socket.on("conversation:new", newHandler);
    socket.on("conversation:update", updateHandler);
    socket.on("conversation:remove", removeHandler);
    socket.on("call:incoming", incomingCallHandler);

    return () => {
      socket.off("conversation:new", newHandler);
      socket.off("conversation:update", updateHandler);
      socket.off("conversation:remove", removeHandler);
      socket.off("call:incoming", incomingCallHandler);
    };
  }, [router, conversationId]);

  return (
    <>
      <IncomingCallModal
        user={otherUser!}
        roomId={roomId!}
        isOpen={isCallOpen}
        onClose={() => setIsCallOpen(false)}
      />
      <GroupChatModal
        users={users}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
      <aside
        className={clsx(
          `
      fixed 
      inset-y-0
      pb-20
      lg:pb-0
      lg:w-80 
      lg:left-20
      lg:block
      overflow-y-auto
      border-r
      border-border
      `,
          isOpen ? "hidden" : "block w-full left-0"
        )}>
        <div className="px-5">
          <div className="flex justify-between mb-4 pt-4">
            <div className="text-2xl font-bold text-foreground">Hộp thư</div>
            <div
              onClick={() => setIsModalOpen(true)}
              className="
                    rounded-full
                    p-2
                    bg-muted
                    text-muted-foreground
                    cursor-pointer
                    hover:opacity-75
                    transition
                    ">
              <MdOutlineGroupAdd size={20} />
            </div>
          </div>
          {items.map((item) => (
            <ConversationBox
              key={item.id}
              data={item}
              selected={conversationId === item.id}
            />
          ))}
        </div>
      </aside>
    </>
  );
};

export default ConversationList;
