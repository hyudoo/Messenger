"use client";

import axios from "axios";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";

import { getSocket, subscribeConversation } from "@/app/libs/socket-client";
import useConversation from "@/app/hooks/useConversation";
import MessageBox from "./MessageBox";
import { FullMessageType } from "@/app/types";
import { find } from "lodash";

interface BodyProps {
  initialMessages: FullMessageType[];
  initialHasMore: boolean;
}

// how close to the top (px) scrolling has to get before older messages load
const LOAD_OLDER_THRESHOLD = 120;

const Body: React.FC<BodyProps> = ({
  initialMessages = [],
  initialHasMore,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  // scrollHeight before older messages were prepended, to keep the viewport in place
  const heightBeforePrependRef = useRef<number | null>(null);

  const { conversationId } = useConversation();

  useEffect(() => {
    axios.post(`/api/conversations/${conversationId}/seen`);
  }, [conversationId]);

  useEffect(() => {
    const socket = getSocket();
    const unsubscribe = subscribeConversation(conversationId);
    bottomRef?.current?.scrollIntoView();

    const messageHandler = (message: FullMessageType) => {
      axios.post(`/api/conversations/${conversationId}/seen`);

      setMessages((current) => {
        if (find(current, { id: message.id })) {
          return current;
        }
        return [...current, message];
      });
      bottomRef?.current?.scrollIntoView();
    };

    const updateMessagesHandler = (newMessage: FullMessageType) => {
      setMessages((current) =>
        current.map((currentMessage) => {
          if (currentMessage.id === newMessage.id) {
            return newMessage;
          }
          return currentMessage;
        })
      );
    };

    socket.on("messages:new", messageHandler);
    socket.on("messages:update", updateMessagesHandler);
    return () => {
      unsubscribe();
      socket.off("messages:new", messageHandler);
      socket.off("messages:update", updateMessagesHandler);
    };
  }, [conversationId]);

  // After older messages are prepended, shift the scroll position by the added
  // height so the message the user was looking at stays put.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const previousHeight = heightBeforePrependRef.current;
    if (container && previousHeight !== null) {
      container.scrollTop += container.scrollHeight - previousHeight;
      heightBeforePrependRef.current = null;
    }
  }, [messages]);

  const loadOlder = async () => {
    const oldest = messages[0];
    if (loadingOlderRef.current || !hasMore || !oldest) {
      return;
    }
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);

    try {
      const { data } = await axios.get<{
        messages: FullMessageType[];
        hasMore: boolean;
      }>(`/api/conversations/${conversationId}/messages`, {
        params: { before: oldest.id },
      });

      heightBeforePrependRef.current = containerRef.current?.scrollHeight ?? null;
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [
          ...data.messages.filter((message) => !known.has(message.id)),
          ...current,
        ];
      });
      setHasMore(data.hasMore);
    } catch {
      toast.error("Không tải được tin nhắn cũ hơn!");
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop < LOAD_OLDER_THRESHOLD) {
      loadOlder();
    }
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto">
      {hasMore && (
        <div className="flex justify-center pt-4">
          {/* fallback for when the first page doesn't fill the screen (no scroll) */}
          <button
            type="button"
            onClick={loadOlder}
            disabled={isLoadingOlder}
            className="text-xs text-muted-foreground hover:underline disabled:opacity-50">
            {isLoadingOlder ? "Đang tải..." : "Xem tin nhắn cũ hơn"}
          </button>
        </div>
      )}
      {messages.map((message, i) => (
        <MessageBox
          isLast={i === messages.length - 1}
          key={message.id}
          data={message}
        />
      ))}
      <div className="pt-24" ref={bottomRef} />
    </div>
  );
};

export default Body;
