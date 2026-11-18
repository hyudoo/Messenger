"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import { getSocket } from "@/app/libs/socket-client";
import { useRouter } from "@/i18n/navigation";

interface JoinButtonProps {
  code: string;
  groupId: string;
  // joining needs an admin's approval (the button asks instead)
  approval: boolean;
  // the user already asked and is waiting
  requested: boolean;
}

// Joins the group (POST /api/join/<code>) and opens its chat. When an admin must approve, it files a
// request and waits: the approval brings the group (conversation:new) and opens the chat, a decline
// (join:declined) says so.
const JoinButton: React.FC<JoinButtonProps> = ({ code, groupId, approval, requested }) => {
  const t = useTranslations("join");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "waiting" | "declined">(
    requested ? "waiting" : "idle"
  );

  useEffect(() => {
    if (state !== "waiting") {
      return;
    }
    const socket = getSocket();
    const approved = (conversation: { id?: string }) => {
      if (conversation?.id === groupId) {
        router.replace(`/conversations/${groupId}`);
      }
    };
    const declined = (payload: { conversationId?: string }) => {
      if (payload?.conversationId === groupId) {
        setState("declined");
      }
    };
    socket.on("conversation:new", approved);
    socket.on("join:declined", declined);
    return () => {
      socket.off("conversation:new", approved);
      socket.off("join:declined", declined);
    };
  }, [state, groupId, router]);

  const join = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post<{ conversationId?: string; requested?: boolean }>(
        `/api/join/${encodeURIComponent(code)}`
      );
      if (data.conversationId) {
        router.replace(`/conversations/${data.conversationId}`);
        return;
      }
      setState("waiting");
      setBusy(false);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      toast.error(
        status === 404
          ? t("invalid")
          : status === 429
            ? t("too_fast")
            : status === 409
              ? t("requests_full")
              : t("failed")
      );
      setBusy(false);
    }
  };

  if (state === "waiting") {
    return (
      <p role="status" className="mt-6 rounded-md bg-muted px-4 py-3 text-sm text-foreground">
        {t("requested")}
      </p>
    );
  }

  return (
    <>
      {state === "declined" && (
        <p role="status" className="mt-6 text-sm text-rose-500">
          {t("declined")}
        </p>
      )}
      {approval && state === "idle" && (
        <p className="mt-4 text-xs text-muted-foreground">{t("approval_hint")}</p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={join}
        className="mt-6 w-full rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
        {approval ? t("ask") : t("join")}
      </button>
    </>
  );
};

export default JoinButton;
