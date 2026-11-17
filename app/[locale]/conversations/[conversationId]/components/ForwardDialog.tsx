"use client";

import axios from "axios";
import clsx from "clsx";
import { create } from "zustand";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import Modal from "@/app/components/modals/Modal";
import Avatar from "@/app/components/Avatar";
import AvatarGroup from "@/app/components/AvatarGroup";
import SearchInput from "@/app/components/inputs/SearchInput";
import { matchesSearch } from "@/app/libs/search";
import { FullConversationType, FullMessageType } from "@/app/types";
import { MessageSnippet } from "./MessageReply";

interface ForwardStore {
  // the message being forwarded, or null (closed)
  message: FullMessageType | null;
  open: (message: FullMessageType) => void;
  close: () => void;
}

// Opened from a message's actions (hover icon, mobile menu); the dialog is mounted once by Body.
export const useForward = create<ForwardStore>((set) => ({
  message: null,
  open: (message) => set({ message }),
  close: () => set({ message: null }),
}));

type SendState = "sending" | "sent" | "failed";

// Forward a message: the user's conversations (searchable), each with its own "Send" button,
// like Messenger; a conversation can be sent to once per opening.
const ForwardDialog = () => {
  const message = useForward((state) => state.message);
  const close = useForward((state) => state.close);
  return (
    <Modal isOpen={!!message} onClose={close}>
      {/* keyed: a fresh list and send states for each message */}
      {message && <ForwardList key={message.id} message={message} />}
    </Modal>
  );
};

const ForwardList: React.FC<{ message: FullMessageType }> = ({ message }) => {
  const t = useTranslations("forward");
  const myEmail = useSession().data?.user?.email;
  const [conversations, setConversations] = useState<FullConversationType[] | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState<Record<string, SendState>>({});

  useEffect(() => {
    let cancelled = false;
    axios
      .get<FullConversationType[]>("/api/conversations")
      .then(({ data }) => !cancelled && setConversations(data))
      .catch(() => !cancelled && setFailedToLoad(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const titleOf = (conversation: FullConversationType) =>
    conversation.name ||
    conversation.users
      .filter((user) => user.email !== myEmail)
      .map((user) => user.name)
      .join(", ");

  const shown = (conversations ?? []).filter((conversation) =>
    matchesSearch(
      query,
      conversation.name,
      ...conversation.users.filter((user) => user.email !== myEmail).map((user) => user.name)
    )
  );

  const forward = (conversationId: string) => {
    setSent((current) => ({ ...current, [conversationId]: "sending" }));
    axios
      .post(`/api/messages/${message.id}/forward`, { conversationId })
      .then(() => setSent((current) => ({ ...current, [conversationId]: "sent" })))
      .catch(() => setSent((current) => ({ ...current, [conversationId]: "failed" })));
  };

  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
      <p className="mb-4 mt-1 truncate rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <MessageSnippet message={message} />
      </p>
      <SearchInput value={query} onChange={setQuery} placeholder={t("search")} />
      <ul className="max-h-80 overflow-y-auto">
        {conversations === null && !failedToLoad && (
          <li className="py-4 text-center text-sm text-muted-foreground">{t("loading")}</li>
        )}
        {failedToLoad && <li className="py-4 text-center text-sm text-rose-500">{t("load_failed")}</li>}
        {shown.map((conversation) => {
          const state = sent[conversation.id];
          const other = conversation.users.find((user) => user.email !== myEmail);
          return (
            <li key={conversation.id} className="flex items-center gap-3 py-2">
              {conversation.isGroup ? <AvatarGroup users={conversation.users} image={conversation.image} /> : <Avatar user={other} />}
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{titleOf(conversation)}</span>
              <button
                type="button"
                disabled={state === "sending" || state === "sent"}
                onClick={() => forward(conversation.id)}
                className={clsx(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold transition",
                  state === "sent"
                    ? "bg-muted text-muted-foreground"
                    : state === "failed"
                      ? "bg-rose-500 text-white hover:bg-rose-600"
                      : "bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-60"
                )}>
                {state === "sent"
                  ? t("sent")
                  : state === "sending"
                    ? t("sending")
                    : state === "failed"
                      ? t("retry")
                      : t("send")}
              </button>
            </li>
          );
        })}
        {conversations && shown.length === 0 && (
          <li className="py-4 text-center text-sm text-muted-foreground">{t("no_results")}</li>
        )}
      </ul>
    </div>
  );
};

export default ForwardDialog;
