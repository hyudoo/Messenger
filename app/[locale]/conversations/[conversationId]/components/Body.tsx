"use client";

import axios from "axios";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { HiArrowDown } from "react-icons/hi2";

import { getSocket, subscribeConversation } from "@/app/libs/socket-client";
import useConversation from "@/app/hooks/useConversation";
import MessageBox from "./MessageBox";
import { FullMessageType } from "@/app/types";

interface BodyProps {
  initialMessages: FullMessageType[];
  initialHasMore: boolean;
}

interface MessagePage {
  messages: FullMessageType[];
  hasMore: boolean;
}

// how close to the top (px) scrolling has to get before older messages load
const LOAD_OLDER_THRESHOLD = 120;
// within this distance (px) of the bottom, new messages scroll into view; further up the user
// is reading older ones, so a "new messages" button shows instead
const STICK_TO_BOTTOM_THRESHOLD = 150;

// Adds messages not shown yet (by id) after the current ones, keeping the order.
const appendNew = (current: FullMessageType[], incoming: FullMessageType[]) => {
  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  return fresh.length > 0 ? [...current, ...fresh] : current;
};

const Body: React.FC<BodyProps> = ({
  initialMessages = [],
  initialHasMore,
}) => {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  // messages that arrived while the user was scrolled up
  const [unseenCount, setUnseenCount] = useState(0);
  const loadingOlderRef = useRef(false);
  // scrollHeight before older messages were prepended, to keep the viewport in place
  const heightBeforePrependRef = useRef<number | null>(null);
  // set before a render that should end scrolled to the bottom (read in the layout effect)
  const scrollToBottomRef = useRef(true);
  const nearBottomRef = useRef(true);
  // the latest messages for the socket handlers, which are registered once per conversation
  const messagesRef = useRef(messages);

  const { conversationId } = useConversation();
  const myEmail = useSession().data?.user?.email;
  const myEmailRef = useRef(myEmail);

  useLayoutEffect(() => {
    messagesRef.current = messages;
    myEmailRef.current = myEmail;
  });

  useEffect(() => {
    // "seen" only while the user can actually see the chat: not from a hidden tab, and again
    // once the tab comes back
    const markSeen = () => {
      if (document.visibilityState === "visible") {
        axios.post(`/api/conversations/${conversationId}/seen`).catch(() => {});
      }
    };

    const socket = getSocket();
    const unsubscribe = subscribeConversation(conversationId);
    markSeen();

    const showIncoming = (incoming: FullMessageType[]) => {
      if (incoming.length === 0) {
        return;
      }
      const ownSent = incoming.some((message) => message.sender?.email === myEmailRef.current);
      if (nearBottomRef.current || ownSent) {
        scrollToBottomRef.current = true;
      } else {
        const known = new Set(messagesRef.current.map((message) => message.id));
        setUnseenCount((count) => count + incoming.filter((m) => !known.has(m.id)).length);
      }
      setMessages((current) => appendNew(current, incoming));
      markSeen();
    };

    const messageHandler = (message: FullMessageType) => showIncoming([message]);

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

    // Messages sent while the socket was down never arrive as messages:new, so every
    // (re)connection fetches what came after the last one shown.
    const resyncHandler = async () => {
      const last = messagesRef.current[messagesRef.current.length - 1];
      try {
        const { data } = await axios.get<MessagePage>(
          `/api/conversations/${conversationId}/messages`,
          { params: last ? { after: last.id } : {} }
        );
        if (last && data.hasMore) {
          // more than a page was missed: start again from the latest page
          const latest = await axios.get<MessagePage>(
            `/api/conversations/${conversationId}/messages`
          );
          scrollToBottomRef.current = true;
          setUnseenCount(0);
          setMessages(latest.data.messages);
          setHasMore(latest.data.hasMore);
          markSeen();
          return;
        }
        if (!last) {
          // nothing was shown: this was the latest page
          setHasMore(data.hasMore);
        }
        showIncoming(data.messages);
      } catch {
        // keep what is shown; the next reconnect tries again
      }
    };

    document.addEventListener("visibilitychange", markSeen);
    socket.on("messages:new", messageHandler);
    socket.on("messages:update", updateMessagesHandler);
    socket.on("connect", resyncHandler);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", markSeen);
      socket.off("messages:new", messageHandler);
      socket.off("messages:update", updateMessagesHandler);
      socket.off("connect", resyncHandler);
    };
  }, [conversationId]);

  // After older messages are prepended, shift the scroll position by the added
  // height so the message the user was looking at stays put. After new ones
  // (while at the bottom), follow them down.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const previousHeight = heightBeforePrependRef.current;
    if (container && previousHeight !== null) {
      container.scrollTop += container.scrollHeight - previousHeight;
      heightBeforePrependRef.current = null;
    } else if (scrollToBottomRef.current) {
      bottomRef.current?.scrollIntoView();
    }
    scrollToBottomRef.current = false;
  }, [messages]);

  const loadOlder = async () => {
    const oldest = messages[0];
    if (loadingOlderRef.current || !hasMore || !oldest) {
      return;
    }
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);

    try {
      const { data } = await axios.get<MessagePage>(
        `/api/conversations/${conversationId}/messages`,
        { params: { before: oldest.id } }
      );

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
      toast.error(t("load_older_failed"));
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    nearBottomRef.current =
      scrollHeight - scrollTop - clientHeight < STICK_TO_BOTTOM_THRESHOLD;
    if (nearBottomRef.current && unseenCount > 0) {
      setUnseenCount(0);
    }
    if (scrollTop < LOAD_OLDER_THRESHOLD) {
      loadOlder();
    }
  };

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnseenCount(0);
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto">
        {hasMore && (
          <div className="flex justify-center pt-4">
            {/* fallback for when the first page doesn't fill the screen (no scroll) */}
            <button
              type="button"
              onClick={loadOlder}
              disabled={isLoadingOlder}
              className="text-xs text-muted-foreground hover:underline disabled:opacity-50">
              {isLoadingOlder ? tCommon("loading") : t("load_older")}
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
      {unseenCount > 0 && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="
            absolute
            bottom-4
            left-1/2
            -translate-x-1/2
            flex
            items-center
            gap-1
            rounded-full
            bg-sky-500
            px-4
            py-2
            text-sm
            text-white
            shadow-lg
            transition
            hover:bg-sky-600">
          <HiArrowDown size={16} aria-hidden />
          {t("new_messages", { count: unseenCount })}
        </button>
      )}
    </div>
  );
};

export default Body;
