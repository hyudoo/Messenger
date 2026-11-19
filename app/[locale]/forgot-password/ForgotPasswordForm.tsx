"use client";

import axios from "axios";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import Button from "@/app/components/Button";

// Asks for a reset link (POST /api/password/forgot). The answer never says whether the address
// has an account, so the page always reads "if it does, we sent a link".
const ForgotPasswordForm: React.FC = () => {
  const t = useTranslations("forgot");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "too_fast" | "off">("idle");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    try {
      await axios.post("/api/password/forgot", { email: email.trim(), locale });
      setState("sent");
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      setState(status === 429 ? "too_fast" : status === 503 ? "off" : "error");
    }
  };

  if (state === "sent") {
    return (
      <p role="status" className="rounded-md bg-muted px-4 py-3 text-sm text-foreground">
        {t("sent", { email: email.trim() })}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium leading-6 text-foreground">
          {t("email")}
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 block w-full rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input focus:ring-2 focus:ring-inset focus:ring-sky-600 sm:text-sm sm:leading-6"
        />
      </div>
      {(state === "error" || state === "too_fast" || state === "off") && (
        <p role="alert" className="text-sm text-rose-500">
          {state === "too_fast" ? t("too_fast") : state === "off" ? t("not_available") : t("failed")}
        </p>
      )}
      <Button disabled={state === "sending" || !email.trim()} fullWidth type="submit">
        {t("send")}
      </Button>
    </form>
  );
};

export default ForgotPasswordForm;
