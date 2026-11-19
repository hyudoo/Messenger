"use client";

import axios from "axios";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { HiOutlineCheckCircle, HiOutlineExclamationTriangle, HiOutlineShieldCheck } from "react-icons/hi2";

import { AccountCardHeading } from "@/app/components/AccountShell";
import Button from "@/app/components/Button";
import { Link } from "@/i18n/navigation";

const PRIMARY_LINK =
  "flex w-full justify-center rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

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
      <div role="status">
        <AccountCardHeading
          tone="success"
          icon={<HiOutlineCheckCircle />}
          title={t("done_title")}
          intro={t("done")}
        />
        <Link href="/" className={PRIMARY_LINK}>
          {t("sign_in")}
        </Link>
      </div>
    );
  }

  if (state === "invalid") {
    return <VerifyLinkInvalid />;
  }

  return (
    <>
      <AccountCardHeading icon={<HiOutlineShieldCheck />} title={t("page_title")} intro={t("page_intro")} />
      {state !== "idle" && (
        <p
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
          <HiOutlineExclamationTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {t(state)}
        </p>
      )}
      <Button type="button" fullWidth disabled={busy} onClick={verify}>
        {busy ? t("verifying") : t("confirm")}
      </Button>
    </>
  );
};

// No token, or the server said it is unknown / used / expired: signing in offers a new one.
export const VerifyLinkInvalid: React.FC = () => {
  const t = useTranslations("verify");
  return (
    <div role="alert">
      <AccountCardHeading
        tone="danger"
        icon={<HiOutlineExclamationTriangle />}
        title={t("invalid_title")}
        intro={t("invalid")}
      />
      <Link href="/" className={PRIMARY_LINK}>
        {t("sign_in")}
      </Link>
    </div>
  );
};

export default VerifyEmailButton;
