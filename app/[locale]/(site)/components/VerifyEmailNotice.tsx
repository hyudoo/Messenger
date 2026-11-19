"use client";

import axios from "axios";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useLocale, useTranslations } from "next-intl";

import Button from "@/app/components/Button";

interface VerifyEmailNoticeProps {
  email: string;
  // "sent": just registered, the mail is on its way; "unverified": tried to sign in before verifying
  reason: "sent" | "unverified";
  onBack: () => void;
}

// In place of the login form while an account waits for its email to be verified: where the link
// went, a button for a new one (POST /api/email/resend, the same answer for any address) and back.
const VerifyEmailNotice: React.FC<VerifyEmailNoticeProps> = ({ email, reason, onBack }) => {
  const t = useTranslations("verify");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  const resend = () => {
    setBusy(true);
    axios
      .post("/api/email/resend", { email, locale })
      .then(() => toast.success(t("resent")))
      .catch((error) =>
        toast.error(error?.response?.status === 429 ? t("too_many") : t("resend_failed"))
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-8">
      <div className="space-y-4 rounded-2xl border border-border bg-background p-6 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.12)] sm:p-8">
        <h2 className="text-lg font-semibold text-foreground">
          {reason === "sent" ? t("sent_title") : t("unverified_title")}
        </h2>
        <p role="status" className="text-sm text-muted-foreground">
          {t(reason === "sent" ? "sent_body" : "unverified_body", { email })}
        </p>
        <p className="text-xs text-muted-foreground">{t("spam_hint")}</p>
        <div className="flex flex-col gap-2">
          <Button type="button" fullWidth disabled={busy} onClick={resend}>
            {t("resend")}
          </Button>
          <Button type="button" fullWidth secondary disabled={busy} onClick={onBack}>
            {t("back")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailNotice;
