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
import { FullMessageType, SafeUser } from "@/app/types";
import useOutbox, { OutboxItem } from "@/app/hooks/useOutbox";
import useDateLocale from "@/app/hooks/useDateLocale";
import { startsGroup, startsNewDay } from "@/app/libs/message-groups";
import { ImageViewerProvider } from "./ImageViewer";
import ForwardDialog from "./ForwardDialog";
import { flashMessage } from "./MessageReply";
import useMessageJump, { onMessageJump } from "@/app/hooks/useMessageJump";
// only the query string: navigation itself goes through @/i18n/navigation
import { useSearchParams } from "next/navigation";
import { format, isToday, isYesterday } from "date-fns";
import {
  MAX_KEPT_MESSAGES,
  keepNewest,
  scrollIntoViewSettled,
} from "@/app/libs/message-window";

interface BodyProps {
  initialMessages: FullMessageType[];
  initialHasMore: boolean;
  // the conversation's members, for the names in "X is typing"
  members: SafeUser[];
  // the first message the user hadn't read when opening the chat: a "new messages" divider goes
  // before it, and the chat opens there instead of at the bottom
  firstUnreadId?: string | null;
  // false when the user hides their read receipts (then they see nobody's either)
  showReceipts?: boolean;
  // a group: a call going on can be joined from its call message
  isGroup?: boolean;
}

// "typing" events refresh every few seconds while someone types (Form); without one for this
// long the indicator goes, so a lost "stopped typing" can't leave it stuck
const TYPING_TIMEOUT_MS = 5000;

interface MessagePage {
  messages: FullMessageType[];
  hasMore: boolean;
}

// how many older pages a jump to a message (search, reply quote) may load to find it
const MAX_JUMP_PAGES = 10;

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

// A pending outbox entry drawn like a message of the current user.
const outboxMessage = (item: OutboxItem, me: Partial<SafeUser>): FullMessageType =>
  ({
    id: item.clientId,
    body: item.payload.message ?? null,
    image: item.payload.image ?? null,
    attachment: item.payload.attachment ? { duration: null, ...item.payload.attachment } : null,
    createdAt: item.createdAt,
    conversationId: item.conversationId,
    sender: me,
    seen: [],
    reactions: [],
    replyTo: item.replyTo ?? null,
  }) as unknown as FullMessageType;

// "Today", "Yesterday" or the date, between the messages of different days
const DayDivider: React.FC<{ date: Date | string }> = ({ date }) => {
  const t = useTranslations("chat");
  const dateLocale = useDateLocale();
  const day = new Date(date);
  const label = isToday(day)
    ? t("today")
    : isYesterday(day)
      ? t("yesterday")
      : format(day, "PPP", { locale: dateLocale });
  return (
    <div className="flex items-center gap-3 px-4 pt-6 pb-2" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
};

const Body: React.FC<BodyProps> = ({
  initialMessages = [],
  initialHasMore,
  firstUnreadId,
  members,
  showReceipts = true,
  isGroup = false,
}) => {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const unreadDividerRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  // messages that arrived while the user was scrolled up
  const [unseenCount, setUnseenCount] = useState(0);
  // email -> when their last "typing" arrived
  const [typing, setTyping] = useState<Record<string, number>>({});
  const loadingOlderRef = useRef(false);
  // scrollHeight before older messages were prepended, to keep the viewport in place
  const heightBeforePrependRef = useRef<number | null>(null);
  // set before a render that should end scrolled to the bottom (read in the layout effect)
  const scrollToBottomRef = useRef(true);
  const nearBottomRef = useRef(true);
  const isFirstLayoutRef = useRef(true);
  // a message to show once the older pages loaded for it are rendered
  const pendingJumpRef = useRef<string | null>(null);
  const hasMoreRef = useRef(initialHasMore);
  // the latest messages for the socket handlers, which are registered once per conversation
  const messagesRef = useRef(messages);

  const { conversationId } = useConversation();
  const sessionUser = useSession().data?.user;
  const myEmail = sessionUser?.email;
  const outbox = useOutbox((state) => state.items);
  const { retry, discard } = useOutbox.getState();
  const myEmailRef = useRef(myEmail);

  useLayoutEffect(() => {
    messagesRef.current = messages;
    hasMoreRef.current = hasMore;
    myEmailRef.current = myEmail;
  });

  // Showing a message (search result, reply quote): at once when it is loaded, else after
  // loading older pages until it turns up (at most MAX_JUMP_PAGES).
  useEffect(
    () =>
      onMessageJump(async (messageId) => {
        if (flashMessage(messageId)) {
          return;
        }
        const pages: FullMessageType[][] = [];
        let cursor = messagesRef.current[0]?.id;
        let more = hasMoreRef.current;
        let found = false;
        try {
          for (let page = 0; page < MAX_JUMP_PAGES && more && cursor && !found; page++) {
            const { data } = await axios.get<MessagePage>(
              `/api/conversations/${conversationId}/messages`,
              { params: { before: cursor } }
            );
            pages.unshift(data.messages);
            found = data.messages.some((message) => message.id === messageId);
            cursor = data.messages[0]?.id;
            more = data.hasMore;
          }
        } catch {
          // shown below as "not found"
        }
        if (pages.length > 0) {
          pendingJumpRef.current = found ? messageId : null;
          setMessages((current) => {
            const known = new Set(current.map((message) => message.id));
            return [...pages.flat().filter((message) => !known.has(message.id)), ...current];
          });
          setHasMore(more);
        }
        if (!found) {
          toast.error(t("jump_not_found"));
        }
      }),
    [conversationId, t]
  );

  // Opened from the inbox's message search (/conversations/<id>?message=<id>): show that message,
  // then drop the parameter so a reload doesn't jump again. After the jump handler above (effects
  // run in order), and again when another result of this same chat is picked.
  const jumpParam = useSearchParams().get("message");
  useEffect(() => {
    if (!jumpParam || !/^[a-f\d]{24}$/i.test(jumpParam)) {
      return;
    }
    useMessageJump.getState().request(jumpParam);
    window.history.replaceState(null, "", window.location.pathname);
  }, [jumpParam]);

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
      const following = nearBottomRef.current || ownSent;
      if (following) {
        scrollToBottomRef.current = true;
      } else {
        const known = new Set(messagesRef.current.map((message) => message.id));
        setUnseenCount((count) => count + incoming.filter((m) => !known.has(m.id)).length);
      }
      // at the bottom of a long chat the oldest messages go (scrolling up loads them again);
      // never while the user reads further up
      setMessages((current) => {
        const next = appendNew(current, incoming);
        return following ? keepNewest(next) : next;
      });
      if (following && messagesRef.current.length + incoming.length > MAX_KEPT_MESSAGES) {
        setHasMore(true);
      }
      markSeen();
    };

    const stopTypingOf = (email: string | null | undefined) =>
      setTyping((current) => {
        if (!email || !(email in current)) {
          return current;
        }
        const next = { ...current };
        delete next[email];
        return next;
      });

    const messageHandler = (message: FullMessageType) => {
      stopTypingOf(message.sender?.email);
      showIncoming([message]);
    };

    // An edited / recalled message replaces its copy, and the quotes of the replies to it.
    const updateMessagesHandler = (newMessage: FullMessageType) => {
      setMessages((current) =>
        current.map((currentMessage) => {
          if (currentMessage.id === newMessage.id) {
            return newMessage;
          }
          if (currentMessage.replyTo?.id === newMessage.id) {
            return {
              ...currentMessage,
              replyTo: {
                ...currentMessage.replyTo,
                body: newMessage.body,
                image: newMessage.image,
                deletedAt: newMessage.deletedAt,
              },
            };
          }
          return currentMessage;
        })
      );
    };

    const typingHandler = (event: {
      conversationId: string;
      email: string;
      typing: boolean;
    }) => {
      if (event.conversationId !== conversationId || event.email === myEmailRef.current) {
        return; // another chat, or the user's own other tab
      }
      if (event.typing) {
        setTyping((current) => ({ ...current, [event.email]: Date.now() }));
      } else {
        stopTypingOf(event.email);
      }
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
    // deleted for the user only (here or in another tab)
    const hideHandler = (event: { conversationId: string; messageId: string }) => {
      if (event.conversationId === conversationId) {
        setMessages((current) => current.filter((message) => message.id !== event.messageId));
      }
    };

    socket.on("typing", typingHandler);
    socket.on("messages:hide", hideHandler);
    return () => {
      socket.off("typing", typingHandler);
      socket.off("messages:hide", hideHandler);
      unsubscribe();
      document.removeEventListener("visibilitychange", markSeen);
      socket.off("messages:new", messageHandler);
      socket.off("messages:update", updateMessagesHandler);
      socket.off("connect", resyncHandler);
    };
  }, [conversationId]);

  // drops typing entries that weren't refreshed in time
  const typingCount = Object.keys(typing).length;
  useEffect(() => {
    if (typingCount === 0) {
      return;
    }
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((current) => {
        const fresh = Object.entries(current).filter(([, at]) => now - at < TYPING_TIMEOUT_MS);
        return fresh.length === Object.keys(current).length ? current : Object.fromEntries(fresh);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typingCount]);

  const typingNames = Object.keys(typing)
    .map((email) => members.find((member) => member.email === email)?.name)
    .filter((name): name is string => !!name);

  // After older messages are prepended, shift the scroll position by the added
  // height so the message the user was looking at stays put. After new ones
  // (while at the bottom), follow them down.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const previousHeight = heightBeforePrependRef.current;
    if (pendingJumpRef.current) {
      // older pages loaded for a jump: go to that message instead of keeping the place
      flashMessage(pendingJumpRef.current);
      pendingJumpRef.current = null;
      heightBeforePrependRef.current = null;
    } else if (container && previousHeight !== null) {
      container.scrollTop += container.scrollHeight - previousHeight;
      heightBeforePrependRef.current = null;
    } else if (scrollToBottomRef.current) {
      // opening the chat with unread messages: start at the first of them (the browser stops at
      // the bottom when they fit on the screen)
      const divider = isFirstLayoutRef.current ? unreadDividerRef.current : null;
      const target = divider ?? bottomRef.current;
      if (target) {
        scrollIntoViewSettled(target, divider ? { block: "start" } : undefined);
      }
    }
    scrollToBottomRef.current = false;
    isFirstLayoutRef.current = false;
  }, [messages]);

  // This conversation's outbox entries not in the list yet. A sent one is dropped as soon as its
  // message is in the list (socket or resync), so it never shows twice.
  // (by id, or by the clientId messages:new echoes when it beats the HTTP response)
  const knownIds = new Set(messages.map((message) => message.id));
  const knownClientIds = new Set(messages.map((message) => message.clientId));
  const isDelivered = (item: OutboxItem) =>
    knownClientIds.has(item.clientId) || (!!item.message && knownIds.has(item.message.id));
  const outboxHere = outbox.filter(
    (item) => item.conversationId === conversationId && !isDelivered(item)
  );
  const outboxDone = outbox.filter(
    (item) => item.conversationId === conversationId && isDelivered(item)
  );
  useEffect(() => {
    outboxDone.forEach((item) => discard(item.clientId));
  });

  // a message the user just sent always scrolls into view
  const outboxCount = outboxHere.length;
  const previousOutboxCount = useRef(outboxCount);
  useLayoutEffect(() => {
    if (outboxCount > previousOutboxCount.current && bottomRef.current) {
      scrollIntoViewSettled(bottomRef.current);
    }
    previousOutboxCount.current = outboxCount;
  }, [outboxCount]);

  const me: Partial<SafeUser> = {
    name: sessionUser?.name ?? null,
    email: sessionUser?.email ?? null,
    image: sessionUser?.image ?? null,
  };
  const shown: { message: FullMessageType; item?: OutboxItem }[] = [
    ...messages.map((message) => ({ message })),
    ...outboxHere.map((item) => ({
      message: item.message ?? outboxMessage(item, me),
      item,
    })),
  ];

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

  // the images the viewer can move between (the loaded pages, oldest first)
  const images = messages
    .filter((message) => message.image && !message.deletedAt)
    .map((message) => message.image!);

  return (
    <ImageViewerProvider images={images}>
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto">
          {/* Each row has content-visibility: auto, so the browser skips the layout and painting
              of rows off the screen (long chats); contain-intrinsic-size "auto" remembers a row's
              last real height, the 72px is only a guess for rows never shown. */}
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
          {shown.map(({ message, item }, i) => {
            const previous = shown[i - 1]?.message;
            return (
              <div
                key={item?.clientId ?? message.id}
                className="[contain-intrinsic-size:auto_72px] [content-visibility:auto]">
                {startsNewDay(previous, message) && <DayDivider date={message.createdAt} />}
                {message.id === firstUnreadId && (
                  <div
                    ref={unreadDividerRef}
                    className="flex scroll-mt-4 items-center gap-3 px-4 pt-4 pb-1"
                    role="separator"
                    aria-label={t("unread_divider")}>
                    <div className="h-px flex-1 bg-rose-500/60" />
                    <span className="text-xs font-medium text-rose-500">{t("unread_divider")}</span>
                    <div className="h-px flex-1 bg-rose-500/60" />
                  </div>
                )}
                <MessageBox
                  isLast={i === shown.length - 1}
                  showReceipts={showReceipts}
                  joinableCall={isGroup}
                  showHeader={startsGroup(previous, message)}
                  data={message}
                  pending={
                    item && item.status !== "sent"
                      ? {
                          status: item.status,
                          tooFast: item.tooFast,
                          onRetry: () => retry(item.clientId),
                          onDiscard: () => discard(item.clientId),
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}
          {typingNames.length > 0 && (
            <div className="flex items-center gap-2 px-4 pt-2 text-xs text-muted-foreground" aria-live="polite">
              <span className="flex gap-0.5" aria-hidden>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
              </span>
              {t("typing", { names: typingNames.join(", "), count: typingNames.length })}
            </div>
          )}
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
      <ForwardDialog />
    </ImageViewerProvider>
  );
};

export default Body;
