"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { formatDistanceStrict } from "date-fns";

import useDateLocale from "./useDateLocale";
import { useIsActive, useLastSeen } from "./useActiveList";

// "Active 5 minutes ago" is shown up to this long after going offline, then plain "Offline"
const LAST_SEEN_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

// the current minute, re-rendering once a minute so "5 minutes ago" moves on; 0 while rendering
// on the server and hydrating (no relative time there, so the markup matches)
const subscribeMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
};
const currentMinute = () => Math.floor(Date.now() / MINUTE_MS);
const noMinute = () => 0;

// A 1:1 chat's status line: "Active now", "Active 5 minutes ago" or "Offline".
const usePresenceText = (user?: { email?: string | null; lastSeenAt?: Date | string | null }) => {
  const t = useTranslations();
  const dateLocale = useDateLocale();
  const isActive = useIsActive(user?.email);
  const lastSeen = useLastSeen(user);
  const minute = useSyncExternalStore(subscribeMinute, currentMinute, noMinute);

  if (isActive) {
    return t("common.online");
  }
  if (!lastSeen || minute === 0) {
    return t("common.offline");
  }
  // "now" is the current minute's start (pure render; at most a minute behind)
  const now = minute * MINUTE_MS;
  const ago = now - lastSeen;
  if (ago > LAST_SEEN_MAX_MS) {
    return t("common.offline");
  }
  if (ago < MINUTE_MS) {
    return t("presence.just_now");
  }
  return t("presence.active_ago", {
    time: formatDistanceStrict(lastSeen, now, { locale: dateLocale, roundingMethod: "floor" }),
  });
};

export default usePresenceText;
