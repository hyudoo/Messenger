"use client";

import axios from "axios";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

// Joins the group (POST /api/join/<code>) and opens its chat.
const JoinButton: React.FC<{ code: string }> = ({ code }) => {
  const t = useTranslations("join");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post<{ conversationId: string }>(
        `/api/join/${encodeURIComponent(code)}`
      );
      router.replace(`/conversations/${data.conversationId}`);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      toast.error(status === 404 ? t("invalid") : status === 429 ? t("too_fast") : t("failed"));
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={join}
      className="mt-6 w-full rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
      {t("join")}
    </button>
  );
};

export default JoinButton;
