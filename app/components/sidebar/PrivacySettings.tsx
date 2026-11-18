"use client";

import axios from "axios";
import clsx from "clsx";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

type Blocked = { id: string; name: string | null; email: string | null; image: string | null };
type Privacy = { hideActivity: boolean; hideReadReceipts: boolean; blocked: Blocked[] };

const Switch: React.FC<{
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  onChange: (checked: boolean) => void;
}> = ({ checked, disabled, label, hint, onChange }) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <div className="text-sm font-medium text-foreground">{label}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50",
        checked ? "bg-sky-500" : "bg-muted ring-1 ring-inset ring-border"
      )}>
      <span
        className={clsx(
          "inline-block h-5 w-5 rounded-full bg-background shadow transition",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  </div>
);

// The settings modal's privacy part: the switches (shown as "share", applied at once, like the
// theme) and the blocked people with Unblock. Mounted only while the modal is open.
const PrivacySettings: React.FC = () => {
  const t = useTranslations("privacy");
  const tLegal = useTranslations("legal");
  const router = useRouter();
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    axios
      .get<Privacy>("/api/settings/privacy")
      .then(({ data }) => active && setPrivacy(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  const change = async (patch: Partial<Omit<Privacy, "blocked">>) => {
    if (!privacy) {
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.patch<Omit<Privacy, "blocked">>("/api/settings/privacy", patch);
      setPrivacy({ ...privacy, ...data });
      // the open chat's receipts / last active time come from the server
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (user: Blocked) => {
    if (!privacy) {
      return;
    }
    setBusy(true);
    try {
      await axios.post(`/api/users/${user.id}/block`, { blocked: false });
      setPrivacy({ ...privacy, blocked: privacy.blocked.filter((item) => item.id !== user.id) });
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border pb-12">
      <h2 className="text-base font-semibold leading-7 text-foreground">{t("title")}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("description")}</p>
      {failed ? (
        <p className="mt-6 text-sm text-rose-500">{t("load_failed")}</p>
      ) : !privacy ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          <Switch
            checked={!privacy.hideActivity}
            disabled={busy}
            label={t("activity")}
            hint={t("activity_hint")}
            onChange={(share) => change({ hideActivity: !share })}
          />
          <Switch
            checked={!privacy.hideReadReceipts}
            disabled={busy}
            label={t("receipts")}
            hint={t("receipts_hint")}
            onChange={(share) => change({ hideReadReceipts: !share })}
          />
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("blocked_title", { count: privacy.blocked.length })}
            </div>
            {privacy.blocked.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("blocked_none")}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {privacy.blocked.map((user) => (
                  <li key={user.id} className="flex items-center gap-3 rounded-lg py-1">
                    <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                      <Image fill src={user.image || "/images/placeholder.jpg"} alt="" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{user.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => unblock(user)}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-sky-500 transition hover:bg-muted disabled:opacity-50">
                      {t("unblock")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="mt-6 flex gap-4 text-xs">
        <Link href="/privacy" target="_blank" className="text-sky-500 hover:underline">
          {tLegal("privacy_link")}
        </Link>
        <Link href="/terms" target="_blank" className="text-sky-500 hover:underline">
          {tLegal("terms_link")}
        </Link>
      </div>
    </div>
  );
};

export default PrivacySettings;
