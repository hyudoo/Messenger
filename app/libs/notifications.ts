import { removePushSubscription, syncPushSubscription } from "@/app/libs/push-client";

// Desktop notifications for new messages. The browser permission is asked from the settings
// modal or the inbox prompt (a click, which browsers require); this browser's on / off choice is
// kept in localStorage. When on, Web Push (app/libs/push-client.ts) also notifies with the tab
// closed; the in-tab notifications (MessageNotifications) cover browsers / servers without it.
const STORAGE_KEY = "notifications";
// the inbox prompt (NotificationPrompt) was dismissed with "Not now"
const PROMPT_KEY = "notifications-prompt";

export type NotificationState = "unsupported" | "denied" | "default" | "on" | "off";

const supported = () => typeof window !== "undefined" && "Notification" in window;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the permission alone decides
  }
};

export const getNotificationState = (): NotificationState => {
  if (!supported()) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  if (Notification.permission === "default") {
    return "default";
  }
  return read(STORAGE_KEY) === "off" ? "off" : "on";
};

// The inbox offers to turn notifications on while the browser hasn't been asked yet, unless the
// user said "Not now".
export const shouldPromptForNotifications = () =>
  getNotificationState() === "default" && read(PROMPT_KEY) !== "dismissed";

export const dismissNotificationPrompt = () => write(PROMPT_KEY, "dismissed");

// Keeps Web Push in step with the choice; failures leave the in-tab notifications working.
export const syncPush = (locale: string) =>
  getNotificationState() === "on"
    ? syncPushSubscription(locale).catch((error) => {
        console.warn("[push.sync]", error);
        return false;
      })
    : Promise.resolve(false);

// Turns notifications on (asking for the permission if needed) or off; returns the new state.
export const setNotificationsEnabled = async (
  enabled: boolean,
  locale: string
): Promise<NotificationState> => {
  if (!supported()) {
    return "unsupported";
  }
  if (!enabled) {
    write(STORAGE_KEY, "off");
    await removePushSubscription();
    return getNotificationState();
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  write(STORAGE_KEY, "on");
  await syncPush(locale);
  return getNotificationState();
};
