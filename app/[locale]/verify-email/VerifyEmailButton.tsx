"use client";

import axios from "axios";
import { useState } from "react";
import { useTranslations } from "next-intl";

import Button from "@/app/components/Button";
import { Link } from "@/i18n/navigation";

// Uses a verification link (POST /api/email/verify). Done: the account can sign in.
const VerifyEmailButton: React.FC<{ token: string }> = ({ token }) => {
  const t = useTranslations("verify");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "done" | "invalid" | "failed" | "too_fast">("idle");

  const verify = async () => {
    setBusy(true);
    try {
      await axios.post("/api/email/verify", { token });
      setState("done");
    } catch (failure) {
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      const code = axios.isAxiosError(failure) ? failure.response?.data : undefined;
      setState(code === "invalid_token" ? "invalid" : status === 429 ? "too_fast" : "failed");
    } finally {
      setBusy(false);
    }
  };

  if (state === "done") {
    return (
      <div role="status" className="mt-4 space-y-4">
        <p className="rounded-md bg-muted px-4 py-3 text-sm text-foreground">{t("done")}</p>
        <Link href="/" className="inline-block text-sm font-medium text-sky-500 hover:underline">
          {t("sign_in")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-4">
      <p className="text-sm text-muted-foreground">{t("page_intro")}</p>
      {state !== "idle" && (
        <p role="alert" className="text-sm text-rose-500">
          {t(state)}
        </p>
      )}
      {state !== "invalid" && (
        <Button type="button" fullWidth disabled={busy} onClick={verify}>
          {t("confirm")}
        </Button>
      )}
    </div>
  );
};

export default VerifyEmailButton;
