// Desktop notifications for new messages. The browser permission is asked from the settings
// modal (a click, which browsers require); this tab's on / off choice is kept in localStorage.
const STORAGE_KEY = "notifications";

export type NotificationState = "unsupported" | "denied" | "default" | "on" | "off";

const supported = () => typeof window !== "undefined" && "Notification" in window;

const readChoice = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked
  }
};

const writeChoice = (value: "on" | "off") => {
  try {
    localStorage.setItem(STORAGE_KEY, value);
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
  return readChoice() === "off" ? "off" : "on";
};

// Turns notifications on (asking for the permission if needed) or off; returns the new state.
export const setNotificationsEnabled = async (enabled: boolean): Promise<NotificationState> => {
  if (!supported()) {
    return "unsupported";
  }
  if (!enabled) {
    writeChoice("off");
    return getNotificationState();
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  writeChoice("on");
  return getNotificationState();
};
