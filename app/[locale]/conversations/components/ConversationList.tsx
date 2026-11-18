"use client";

import { SafeUser } from "@/app/types";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import axios from "axios";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { MdOutlineGroupAdd } from "react-icons/md";
import clsx from "clsx";
import { find } from "lodash";

import useConversation from "@/app/hooks/useConversation";
import { getSocket } from "@/app/libs/socket-client";
import GroupChatModal from "@/app/components/modals/GroupChatModal";
import SearchInput from "@/app/components/inputs/SearchInput";
import MessageSearchResults, { MIN_MESSAGE_QUERY } from "./MessageSearchResults";
import { HiArchiveBox, HiChevronDown } from "react-icons/hi2";
import NotificationPrompt from "@/app/components/NotificationPrompt";
import ConversationBox from "./ConversationBox";
import { ConversationSettings, ConversationUpdate, FullConversationType } from "@/app/types";
import { matchesSearch } from "@/app/libs/search";
import { formatUnread } from "@/app/libs/unread";

// "typing" events refresh every few seconds while someone types; without one for this long the
// inbox stops showing it (same as the chat's indicator)
const TYPING_TIMEOUT_MS = 5000;

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
  const [query, setQuery] = useState("");
  // the "Archived" part of the list, unfolded
  const [showArchived, setShowArchived] = useState(false);
  // conversation id -> email -> when their last "typing" arrived (conversation:typing)
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});

  const t = useTranslations("conversations");
  const router = useRouter();
  const myEmail = useSession().data?.user?.email;

  const { conversationId, isOpen } = useConversation();

  // the socket handlers below are registered per conversation, not per session change
  const myEmailRef = useRef(myEmail);
  useLayoutEffect(() => {
    myEmailRef.current = myEmail;
  });

  // Tab title badge: "(3) Messenger" while there are unread messages. Re-applied after
  // navigations, which reset the title from the page metadata.
  // muted and archived conversations don't count (their own badges still show, greyed)
  const totalUnread = items.reduce(
    (sum, item) => sum + (item.muted || item.archived ? 0 : (item.unreadCount ?? 0)),
    0
  );
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    const apply = () => {
      document.title = totalUnread > 0 ? `(${formatUnread(totalUnread)}) ${base}` : base;
    };
    apply();
    const frame = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(frame);
      document.title = base;
    };
  }, [totalUnread, conversationId]);

  // the search box also finds messages in every conversation once the query is long enough
  const searchingMessages = query.trim().length >= MIN_MESSAGE_QUERY;

  // pinned conversations first (each part keeps its order: latest activity first). Archived ones
  // are left out of the list (under "Archived" at the end), but a search finds them too.
  const matching = [
    ...items.filter((item) => item.pinned),
    ...items.filter((item) => !item.pinned),
  ].filter((item) =>
    matchesSearch(
      query,
      item.name,
      ...item.users.filter((user) => user.email !== myEmail).map((user) => user.name)
    )
  );
  const visibleItems = query ? matching : matching.filter((item) => !item.archived);
  const archivedItems = query ? [] : matching.filter((item) => item.archived);

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
    // "Seen" updates don't, so the order stays put. A group change (rename, members added,
    // removed or leaving) sends the name and member list instead of messages.
    const updateHandler = (conversation: ConversationUpdate) => {
      if (conversation.users && conversation.id === conversationId) {
        // the open chat's header and drawer come from the server component
        router.refresh();
      }
      setItems((current) => {
        const target = current.find((item) => item.id === conversation.id);
        if (!target) {
          return current;
        }
        const updated = {
          ...target,
          ...(conversation.messages && {
            messages: conversation.messages,
            unreadCount: nextUnread(target, conversation),
          }),
          ...(conversation.users && {
            users: conversation.users,
            userIds: conversation.userIds ?? target.userIds,
            ownerId: conversation.ownerId ?? null,
            adminIds: conversation.adminIds ?? target.adminIds,
            image: conversation.image === undefined ? target.image : conversation.image,
            inviteCode:
              conversation.inviteCode === undefined ? target.inviteCode : conversation.inviteCode,
            joinApproval: conversation.joinApproval ?? target.joinApproval,
            name: conversation.name ?? target.name,
          }),
          // something new: an archived conversation comes back (the server unarchives it too)
          ...(conversation.lastMessageAt && {
            lastMessageAt: new Date(conversation.lastMessageAt),
            archived: false,
          }),
        };
        if (!conversation.lastMessageAt) {
          return current.map((item) => (item.id === updated.id ? updated : item));
        }
        return [updated, ...current.filter((item) => item.id !== updated.id)];
      });
    };

    // A message the user has seen (or sent) clears the count; a new one from someone else adds
    // one, unless it arrived in the chat the user is looking at (Body marks it seen right away).
    const nextUnread = (target: FullConversationType, update: ConversationUpdate) => {
      const last = update.messages?.[update.messages.length - 1];
      const me = myEmailRef.current;
      if (
        update.read ||
        !last ||
        last.sender?.email === me ||
        last.seen?.some((user) => user.email === me)
      ) {
        return 0;
      }
      const watching =
        update.id === conversationId && document.visibilityState === "visible";
      return update.lastMessageAt && !watching
        ? (target.unreadCount ?? 0) + 1
        : target.unreadCount ?? 0;
    };

    // Events sent while the socket was down are lost (sleep, network change), so every
    // (re)connection reloads the list. Also covers the gap between server render and connect.
    const resyncHandler = () => {
      axios
        .get<FullConversationType[]>("/api/conversations")
        .then(({ data }) => setItems(data))
        .catch(() => {}); // keep what is shown; the next reconnect tries again
    };

    const removeHandler = (conversation: Pick<FullConversationType, "id">) => {
      setItems((current) => {
        return [...current.filter((convo) => convo.id !== conversation.id)];
      });
      if (conversationId === conversation.id) {
        router.push("/conversations");
      }
    };

    const typingHandler = (event: { conversationId: string; email: string; typing: boolean }) => {
      if (event.email === myEmailRef.current) {
        return;
      }
      setTyping((current) => {
        const people = { ...current[event.conversationId] };
        if (event.typing) {
          people[event.email] = Date.now();
        } else if (people[event.email]) {
          delete people[event.email];
        } else {
          return current;
        }
        return { ...current, [event.conversationId]: people };
      });
    };

    socket.on("conversation:new", newHandler);
    // the user's own settings, changed in another tab or the chat's drawer
    const settingsHandler = (settings: ConversationSettings) => {
      setItems((current) =>
        current.map((item) =>
          item.id === settings.id
            ? { ...item, muted: settings.muted, pinned: settings.pinned, archived: settings.archived }
            : item
        )
      );
    };

    // someone blocked / unblocked (the user or the other one): the open chat's composer, call
    // buttons and status change, and so does whose presence may be seen
    const blockHandler = () => {
      if (conversationId) {
        router.refresh();
      }
      socket.emit("presence:sync");
    };

    socket.on("conversation:typing", typingHandler);
    socket.on("block:update", blockHandler);
    socket.on("conversation:settings", settingsHandler);
    socket.on("conversation:update", updateHandler);
    socket.on("conversation:remove", removeHandler);
    socket.on("connect", resyncHandler);

    return () => {
      socket.off("connect", resyncHandler);
      socket.off("conversation:new", newHandler);
      socket.off("conversation:typing", typingHandler);
      socket.off("block:update", blockHandler);
      socket.off("conversation:settings", settingsHandler);
      socket.off("conversation:update", updateHandler);
      socket.off("conversation:remove", removeHandler);
    };
  }, [router, conversationId]);

  // drops typing entries that weren't refreshed in time
  const typingActive = Object.values(typing).some((people) => Object.keys(people).length > 0);
  useEffect(() => {
    if (!typingActive) {
      return;
    }
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((current) => {
        let changed = false;
        const next: typeof current = {};
        Object.entries(current).forEach(([id, people]) => {
          const fresh = Object.entries(people).filter(([, at]) => now - at < TYPING_TIMEOUT_MS);
          changed ||= fresh.length !== Object.keys(people).length;
          if (fresh.length > 0) {
            next[id] = Object.fromEntries(fresh);
          }
        });
        return changed ? next : current;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typingActive]);

  // the names of who is typing in a conversation (the open chat shows its own indicator too)
  const typingNames = (item: FullConversationType) =>
    Object.keys(typing[item.id] ?? {})
      .map((email) => item.users.find((user) => user.email === email)?.name)
      .filter((name): name is string => !!name);

  return (
    <>
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
            <div className="text-2xl font-bold text-foreground">{t("title")}</div>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              aria-label={t("new_group")}
              title={t("new_group")}
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
            </button>
          </div>
          <NotificationPrompt />
          {items.length > 0 && (
            <SearchInput value={query} onChange={setQuery} placeholder={t("search")} />
          )}
          {searchingMessages && visibleItems.length > 0 && (
            <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("chats_heading")}
            </h3>
          )}
          {visibleItems.map((item) => (
            <ConversationBox
              key={item.id}
              data={item}
              selected={conversationId === item.id}
              typingNames={typingNames(item)}
            />
          ))}
          {/* a longer query also searches the messages, which say when nothing matches */}
          {query && !searchingMessages && visibleItems.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("no_results")}</p>
          )}
          {archivedItems.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <button
                type="button"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((shown) => !shown)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <span className="flex items-center gap-2">
                  <HiArchiveBox size={18} aria-hidden />
                  {t("archived_heading", { count: archivedItems.length })}
                </span>
                <HiChevronDown
                  size={16}
                  aria-hidden
                  className={clsx("transition", showArchived && "rotate-180")}
                />
              </button>
              {showArchived &&
                archivedItems.map((item) => (
                  <ConversationBox
                    key={item.id}
                    data={item}
                    selected={conversationId === item.id}
                    typingNames={typingNames(item)}
                  />
                ))}
            </div>
          )}
          {searchingMessages && <MessageSearchResults query={query.trim()} />}
        </div>
      </aside>
    </>
  );
};

export default ConversationList;
