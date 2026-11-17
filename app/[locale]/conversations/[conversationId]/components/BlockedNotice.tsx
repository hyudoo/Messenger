"use client";

import axios from "axios";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

interface BlockedNoticeProps {
  // the other person of the 1:1 chat
  other: { id: string; name: string | null };
  byMe: boolean;
}

// In place of the composer in a blocked 1:1 chat: who blocked whom, and (for one's own block)
// a way to undo it.
const BlockedNotice: React.FC<BlockedNoticeProps> = ({ other, byMe }) => {
  const t = useTranslations("block");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const unblock = () => {
    setBusy(true);
    axios
      .post(`/api/users/${other.id}/block`, { blocked: false })
      .then(() => router.refresh())
      .catch(() => toast.error(t("failed")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex w-full flex-col items-center gap-2 border-t bg-background px-4 py-4 text-center text-sm text-muted-foreground">
      <p>{byMe ? t("blocked_by_me", { name: other.name ?? "" }) : t("blocked_by_them")}</p>
      {byMe && (
        <button
          type="button"
          disabled={busy}
          onClick={unblock}
          className="rounded-md bg-muted px-3 py-1.5 font-medium text-foreground transition hover:opacity-80 disabled:opacity-50">
          {t("unblock")}
        </button>
      )}
    </div>
  );
};

export default BlockedNotice;
