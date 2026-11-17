"use client";

import { useReducer, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { HiOutlineBell, HiXMark } from "react-icons/hi2";
import { toast } from "react-hot-toast";

import {
  dismissNotificationPrompt,
  setNotificationsEnabled,
  shouldPromptForNotifications,
} from "@/app/libs/notifications";

const noSubscribe = () => () => {};

// A one-click offer at the top of the inbox to turn on notifications, shown while the browser
// hasn't been asked yet (the settings modal has the same switch). "Not now" hides it for good in
// this browser.
const NotificationPrompt = () => {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  // re-render after a click, so the browser state is read again
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  // read from the browser only (never during server rendering / hydration)
  const visible = useSyncExternalStore(noSubscribe, shouldPromptForNotifications, () => false);

  if (!visible) {
    return null;
  }

  const enable = async () => {
    setBusy(true);
    const state = await setNotificationsEnabled(true, locale);
    setBusy(false);
    rerender();
    if (state === "denied") {
      toast.error(t("prompt_denied"));
    }
  };

  const later = () => {
    dismissNotificationPrompt();
    rerender();
  };

  return (
    <div
      role="region"
      aria-label={t("prompt_title")}
      className="mb-3 flex items-start gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3">
      <HiOutlineBell className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{t("prompt_title")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("prompt_body")}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2">
            {t("prompt_enable")}
          </button>
          <button
            type="button"
            onClick={later}
            disabled={busy}
            className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            {t("prompt_later")}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={later}
        aria-label={t("prompt_later")}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
        <HiXMark className="h-4 w-4" />
      </button>
    </div>
  );
};

export default NotificationPrompt;
