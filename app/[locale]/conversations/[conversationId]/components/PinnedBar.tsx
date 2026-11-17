"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { HiMapPin, HiXMark } from "react-icons/hi2";

import type { PinnedMessage } from "@/app/actions/getPinnedMessages";
import useMessageJump from "@/app/hooks/useMessageJump";
import usePins from "@/app/hooks/usePins";
import { getSocket } from "@/app/libs/socket-client";
import { MessageSnippet } from "./MessageReply";

interface PinnedBarProps {
  conversationId: string;
  initialPins: PinnedMessage[];
}

export const unpinMessage = (messageId: string, failed: string) =>
  axios
    .post(`/api/messages/${messageId}/pin`, { pinned: false })
    .catch(() => toast.error(failed));

// Under the chat's header: the latest pinned message (a click shows it in the chat) and, with
// several, a list of all of them with "Unpin". Kept live by the chat room's pins:update.
const PinnedBar: React.FC<PinnedBarProps> = ({ conversationId, initialPins }) => {
  const t = useTranslations("pins");
  const [pins, setPins] = useState(initialPins);

  // the message menus read which ones are pinned
  useEffect(() => {
    usePins.getState().set(pins.map((pin) => pin.id));
  }, [pins]);
  useEffect(() => () => usePins.getState().set([]), []);

  useEffect(() => {
    const socket = getSocket();
    const handler = (update: { conversationId: string }) => {
      if (update.conversationId !== conversationId) {
        return;
      }
      axios
        .get<PinnedMessage[]>(`/api/conversations/${conversationId}/pins`)
        .then(({ data }) => setPins(data))
        .catch(() => {}); // keep what is shown
    };
    socket.on("pins:update", handler);
    return () => {
      socket.off("pins:update", handler);
    };
  }, [conversationId]);

  if (pins.length === 0) {
    return null;
  }
  const latest = pins[0];
  const show = (id: string) => useMessageJump.getState().request(id);

  return (
    <div className="flex items-center gap-2 border-b bg-background px-4 py-1.5 text-sm">
      <HiMapPin size={16} aria-hidden className="shrink-0 text-sky-500" />
      <button
        type="button"
        onClick={() => show(latest.id)}
        title={t("show")}
        className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground">
        <span className="font-medium text-foreground">{latest.sender?.name}: </span>
        <MessageSnippet message={latest} />
      </button>
      {pins.length > 1 && (
        <Popover className="relative shrink-0">
          <PopoverButton className="rounded-full px-2 py-0.5 text-xs font-medium text-sky-500 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            {t("all", { count: pins.length })}
          </PopoverButton>
          <PopoverPanel
            anchor={{ to: "bottom end", gap: 6 }}
            className="z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-background p-1 shadow-lg">
            {({ close }) => (
              <ul className="max-h-80 overflow-y-auto">
                {pins.map((pin) => (
                  <li key={pin.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        show(pin.id);
                      }}
                      className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm hover:bg-muted">
                      <span className="font-medium">{pin.sender?.name}: </span>
                      <span className="text-muted-foreground">
                        <MessageSnippet message={pin} />
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => unpinMessage(pin.id, t("failed"))}
                      aria-label={t("unpin")}
                      title={t("unpin")}
                      className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                      <HiXMark size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverPanel>
        </Popover>
      )}
      {pins.length === 1 && (
        <button
          type="button"
          onClick={() => unpinMessage(latest.id, t("failed"))}
          aria-label={t("unpin")}
          title={t("unpin")}
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <HiXMark size={16} aria-hidden />
        </button>
      )}
    </div>
  );
};

export default PinnedBar;
