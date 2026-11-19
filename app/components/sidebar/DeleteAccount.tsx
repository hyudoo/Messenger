"use client";

import axios from "axios";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import Button from "../Button";

const inputClass =
  "form-input mt-1 block w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-rose-500 disabled:opacity-50 sm:text-sm sm:leading-6";

// The settings modal's "Delete account" (DELETE /api/account): what goes is spelled out, then the
// user confirms with their password, or (an account without one) by typing their email address.
// Sits inside the settings <form>: Enter is handled here, not by the form's Save.
const DeleteAccount: React.FC = () => {
  const t = useTranslations("delete_account");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setOpen(true);
    setError(null);
    setValue("");
    try {
      const { data } = await axios.get<{ hasPassword: boolean }>("/api/account");
      setHasPassword(data.hasPassword);
    } catch {
      setError(t("failed"));
    }
  };

  const confirm = async () => {
    if (busy || hasPassword === null || !value.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await axios.delete("/api/account", {
        data: hasPassword ? { password: value } : { email: value },
      });
      // the cookie is already cleared; this also drops next-auth's client state
      await signOut({ callbackUrl: `/${locale}?deleted=1` });
    } catch (failure) {
      const code = axios.isAxiosError(failure) ? failure.response?.data : null;
      const status = axios.isAxiosError(failure) ? failure.response?.status : null;
      setError(
        code === "wrong_password"
          ? t("wrong_password")
          : code === "wrong_email"
            ? t("wrong_email")
            : status === 429
              ? t("too_many")
              : t("failed")
      );
      setBusy(false);
    }
  };

  return (
    <div className="pt-8">
      <h2 className="text-base font-semibold leading-7 text-rose-600 dark:text-rose-400">{t("title")}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("description")}</p>
      {!open ? (
        <div className="mt-4">
          <Button type="button" danger onClick={start}>
            {t("start")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-rose-500/40 p-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            <li>{t("what_messages")}</li>
            <li>{t("what_chats")}</li>
            <li>{t("what_friends")}</li>
            <li>{t("what_files")}</li>
          </ul>
          <p className="text-sm font-medium text-foreground">{t("irreversible")}</p>
          {hasPassword !== null && (
            <div>
              <label htmlFor="delete-account-confirm" className="block text-sm text-muted-foreground">
                {hasPassword ? t("password_label") : t("email_label")}
              </label>
              <input
                id="delete-account-confirm"
                type={hasPassword ? "password" : "email"}
                autoComplete={hasPassword ? "current-password" : "off"}
                disabled={busy}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void confirm();
                  }
                }}
                className={inputClass}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-500">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" danger disabled={busy || hasPassword === null || !value.trim()} onClick={confirm}>
              {busy ? t("deleting") : t("confirm")}
            </Button>
            <Button type="button" secondary disabled={busy} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeleteAccount;
