"use client";

import axios from "axios";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { HiOutlineEnvelope, HiOutlineEnvelopeOpen, HiOutlineExclamationTriangle } from "react-icons/hi2";

import { AccountCardHeading } from "@/app/components/AccountShell";
import Button from "@/app/components/Button";

// Asks for a reset link (POST /api/password/forgot). The answer never says whether the address
// has an account, so the page always reads "if it does, we sent a link".
const ForgotPasswordForm: React.FC<{ minutes: number }> = ({ minutes }) => {
  const t = useTranslations("forgot");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "too_fast" | "off">("idle");

  const send = async () => {
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
      <div>
        <AccountCardHeading
          icon={<HiOutlineEnvelopeOpen />}
          title={t("sent_title")}
          intro={
            <span role="status">
              {t.rich("sent", {
                email: email.trim(),
                b: (chunks) => <strong className="break-all font-medium text-foreground">{chunks}</strong>,
              })}
            </span>
          }
        />
        <p className="rounded-md bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">{t("sent_hint", { minutes })}</p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-4 text-sm font-medium text-sky-600 underline-offset-2 hover:underline dark:text-sky-400">
          {t("other_email")}
        </button>
      </div>
    );
  }

  const failure =
    state === "too_fast" ? t("too_fast") : state === "off" ? t("not_available") : state === "error" ? t("failed") : null;

  return (
    <>
      <AccountCardHeading icon={<HiOutlineEnvelope />} title={t("title")} intro={t("intro")} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="space-y-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium leading-6 text-foreground">
            {t("email")}
          </label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            disabled={state === "sending"}
            onChange={(event) => setEmail(event.target.value)}
            className="form-input mt-2 block w-full rounded-md border-0 bg-background py-2 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-sky-600 disabled:opacity-50 sm:text-sm sm:leading-6"
          />
        </div>
        {failure && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
            <HiOutlineExclamationTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {failure}
          </p>
        )}
        <Button disabled={state === "sending" || !email.trim()} fullWidth type="submit">
          {state === "sending" ? t("sending") : t("send")}
        </Button>
      </form>
    </>
  );
};

export default ForgotPasswordForm;
