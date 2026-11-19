"use client";

import axios from "axios";
import clsx from "clsx";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { HiCheck, HiOutlineCheckCircle, HiOutlineExclamationTriangle, HiOutlineKey } from "react-icons/hi2";

import { AccountCardHeading } from "@/app/components/AccountShell";
import Button from "@/app/components/Button";
import PasswordField from "@/app/components/inputs/PasswordField";
import { passwordChecks, validatePassword } from "@/app/libs/password";
import { Link } from "@/i18n/navigation";

// The new password from a reset link (POST /api/password/reset), with the register form's rules
// shown live as a checklist. Done: a way to sign in with it. A used / expired link: a new one.
const ResetPasswordForm: React.FC<{ token: string }> = ({ token }) => {
  const t = useTranslations("reset");
  const tAuth = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "done" | "invalid">("form");

  const checks = passwordChecks(password);
  const mismatch = repeat.length > 0 && repeat !== password;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const rule = validatePassword(password);
    if (rule) {
      setError(tAuth(`password_rules.${rule}`));
      return;
    }
    if (password !== repeat) {
      setError(tAuth("password_mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await axios.post("/api/password/reset", { token, password });
      setState("done");
    } catch (failure) {
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      const code = axios.isAxiosError(failure) ? failure.response?.data : undefined;
      if (code === "invalid_token") {
        setState("invalid");
      } else {
        setError(status === 429 ? t("too_fast") : t("failed"));
      }
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
        <Link
          href="/"
          className="flex w-full justify-center rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
          {t("sign_in")}
        </Link>
      </div>
    );
  }

  if (state === "invalid") {
    return <ResetLinkInvalid />;
  }

  return (
    <>
      <AccountCardHeading icon={<HiOutlineKey />} title={t("title")} intro={t("intro")} />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <PasswordField
            id="password"
            label={t("password")}
            value={password}
            onChange={setPassword}
            disabled={busy}
            describedBy="password-checks"
            autoFocus
          />
          <ul id="password-checks" className="mt-3 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
            {checks.map(({ code, ok }) => (
              <li
                key={code}
                className={clsx(
                  "flex items-center gap-1.5 transition-colors",
                  ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                )}>
                <span
                  aria-hidden
                  className={clsx(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                    ok ? "bg-green-500/15" : "bg-muted"
                  )}>
                  {ok ? <HiCheck className="h-3 w-3" /> : <span className="h-1 w-1 rounded-full bg-current" />}
                </span>
                <span>
                  {tAuth(`password_checks.${code}`)}
                  <span className="sr-only">{ok ? ` (${t("check_ok")})` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <PasswordField
            id="repeat"
            label={t("repeat")}
            value={repeat}
            onChange={setRepeat}
            disabled={busy}
            invalid={mismatch}
            describedBy={mismatch ? "repeat-hint" : undefined}
          />
          {mismatch && (
            <p id="repeat-hint" className="mt-2 text-xs text-rose-500">
              {tAuth("password_mismatch")}
            </p>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
            <HiOutlineExclamationTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
        <Button disabled={busy} fullWidth type="submit">
          {busy ? t("saving") : t("save")}
        </Button>
      </form>
    </>
  );
};

// No token, or the server said it is unknown / used / expired.
export const ResetLinkInvalid: React.FC = () => {
  const t = useTranslations("reset");
  return (
    <div role="alert">
      <AccountCardHeading
        tone="danger"
        icon={<HiOutlineExclamationTriangle />}
        title={t("invalid_title")}
        intro={t("invalid")}
      />
      <Link
        href="/forgot-password"
        className="flex w-full justify-center rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
        {t("new_link")}
      </Link>
    </div>
  );
};

export default ResetPasswordForm;
