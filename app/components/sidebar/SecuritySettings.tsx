"use client";

import axios from "axios";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { syncPush } from "@/app/libs/notifications";
import { validatePassword } from "@/app/libs/password";
import Button from "../Button";

const inputClass =
  "form-input block w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-sky-600 disabled:opacity-50 sm:text-sm sm:leading-6";

type Field = "currentPassword" | "newPassword" | "confirmPassword";
const FIELDS: { id: Field; autoComplete: string }[] = [
  { id: "currentPassword", autoComplete: "current-password" },
  { id: "newPassword", autoComplete: "new-password" },
  { id: "confirmPassword", autoComplete: "new-password" },
];
const EMPTY: Record<Field, string> = { currentPassword: "", newPassword: "", confirmPassword: "" };

// The settings modal's security part: changing the password and "sign out other devices". Both end
// every other session (app/libs/sessions.ts); this device gets a new cookie and stays signed in.
// It sits inside the settings <form>, so it has no form of its own: Enter is handled here.
// The server forgets every browser's push subscription then, so this one subscribes again.
const SecuritySettings: React.FC = () => {
  const t = useTranslations("security");
  const locale = useLocale();
  const tRules = useTranslations("auth.password_rules");
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [noPassword, setNoPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const changePassword = async () => {
    if (busy) {
      return;
    }
    const ruleError = validatePassword(values.newPassword);
    if (!values.currentPassword) {
      setError(t("current_required"));
      return;
    }
    if (ruleError) {
      setError(tRules(ruleError));
      return;
    }
    if (values.newPassword !== values.confirmPassword) {
      setError(t("mismatch"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await axios.post("/api/password/change", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      setValues(EMPTY);
      void syncPush(locale);
      toast.success(t("changed"));
    } catch (failure) {
      const code = axios.isAxiosError(failure) ? failure.response?.data : null;
      const status = axios.isAxiosError(failure) ? failure.response?.status : null;
      if (code === "no_password") {
        setNoPassword(true);
      } else if (code === "wrong_password") {
        setError(t("wrong_password"));
      } else if (status === 429) {
        setError(t("too_many"));
      } else if (typeof code === "string" && code in RULE_CODES) {
        setError(tRules(code as keyof typeof RULE_CODES));
      } else {
        setError(t("failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const signOutOthers = async () => {
    setBusy(true);
    try {
      await axios.delete("/api/settings/sessions");
      void syncPush(locale);
      toast.success(t("signed_out_others"));
      setConfirmingSignOut(false);
    } catch (failure) {
      const status = axios.isAxiosError(failure) ? failure.response?.status : null;
      toast.error(status === 429 ? t("too_many") : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border pb-12">
      <h2 className="text-base font-semibold leading-7 text-foreground">{t("title")}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("description")}</p>

      <div className="mt-6 flex flex-col gap-y-4">
        <span className="text-sm font-medium text-foreground">{t("change_title")}</span>
        {noPassword ? (
          <p className="text-sm text-muted-foreground">
            {t("no_password")}{" "}
            <Link href="/forgot-password" className="font-medium text-sky-500 hover:underline">
              {t("set_password")}
            </Link>
          </p>
        ) : (
          <>
            {FIELDS.map(({ id, autoComplete }) => (
              <div key={id}>
                <label htmlFor={id} className="block text-sm leading-6 text-muted-foreground">
                  {t(id)}
                </label>
                <input
                  id={id}
                  type="password"
                  autoComplete={autoComplete}
                  disabled={busy}
                  value={values[id]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValues((current) => ({ ...current, [id]: value }));
                  }}
                  onKeyDown={(event) => {
                    // not the settings form's Save
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void changePassword();
                    }
                  }}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
            ))}
            {error && (
              <p role="alert" className="text-sm text-rose-500">
                {error}
              </p>
            )}
            <div>
              <Button type="button" secondary disabled={busy} onClick={changePassword}>
                {t("change_button")}
              </Button>
            </div>
          </>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <span className="block text-sm font-medium text-foreground">{t("sessions_title")}</span>
          <p className="mt-1 text-xs text-muted-foreground">{t("sessions_hint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {confirmingSignOut ? (
              <>
                <Button type="button" danger disabled={busy} onClick={signOutOthers}>
                  {t("sign_out_others_confirm")}
                </Button>
                <Button
                  type="button"
                  secondary
                  disabled={busy}
                  onClick={() => setConfirmingSignOut(false)}>
                  {t("cancel")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                secondary
                disabled={busy}
                onClick={() => setConfirmingSignOut(true)}>
                {t("sign_out_others")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// the password rule codes the server can answer with (app/libs/password.ts)
const RULE_CODES = {
  too_short: true,
  too_long: true,
  no_lowercase: true,
  no_uppercase: true,
  no_digit: true,
  no_special: true,
} as const;

export default SecuritySettings;
