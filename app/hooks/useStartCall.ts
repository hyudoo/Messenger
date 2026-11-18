"use client";

import { useCallback } from "react";
import axios from "axios";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

// Starts a call in the conversation, or joins the one going on (a group call: /api/messages then
// returns the running call message instead of ringing everyone again), and opens the call screen.
// The call message is what rings the others (call:incoming): if it fails (rate limit, server
// error) nobody would ring, so say so instead of leaving the caller waiting in an empty room.
// The room reads the kind back from the call message (getCallType).
const useStartCall = (conversationId: string) => {
  const t = useTranslations("common");
  const router = useRouter();

  return useCallback(
    async (callType: "audio" | "video") => {
      try {
        await axios.post("/api/messages", { isCall: true, callType, conversationId });
        router.push(`/room/${conversationId}`);
      } catch {
        toast.error(t("error"));
      }
    },
    [conversationId, router, t]
  );
};

export default useStartCall;
