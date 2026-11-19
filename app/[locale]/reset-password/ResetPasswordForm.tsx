"use client";

import axios from "axios";
import { useState } from "react";
import { useTranslations } from "next-intl";

import Button from "@/app/components/Button";
import { validatePassword } from "@/app/libs/password";
import { Link } from "@/i18n/navigation";

// The new password from a reset link (POST /api/password/reset), with the register form's rules.
// Done: a link back to signing in with it.
const ResetPasswordForm: React.FC<{ token: string }> = ({ token }) => {
  const t = useTranslations("reset");
  const tAuth = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
      setDone(true);
    } catch (failure) {
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      const code = axios.isAxiosError(failure) ? failure.response?.data : undefined;
      setError(
        code === "invalid_token" ? t("invalid") : status === 429 ? t("too_fast") : t("failed")
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="space-y-4">
        <p className="rounded-md bg-muted px-4 py-3 text-sm text-foreground">{t("done")}</p>
        <Link href="/" className="inline-block text-sm font-medium text-sky-500 hover:underline">
          {t("sign_in")}
        </Link>
      </div>
    );
  }

  const field =
    "mt-2 block w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input focus:ring-2 focus:ring-inset focus:ring-sky-600 sm:text-sm sm:leading-6";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium leading-6 text-foreground">
          {t("password")}
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="repeat" className="block text-sm font-medium leading-6 text-foreground">
          {t("repeat")}
        </label>
        <input
          id="repeat"
          type="password"
          required
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          className={field}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-500">
          {error}
        </p>
      )}
      <Button disabled={busy} fullWidth type="submit">
        {t("save")}
      </Button>
    </form>
  );
};

export default ResetPasswordForm;
