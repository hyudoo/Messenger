import axios from "axios";

// Browser side of Web Push: registers public/sw.js, subscribes with the server's VAPID key and
// sends the subscription to /api/push. Used through app/libs/notifications.ts.

const SW_URL = "/sw.js";
// signing out shouldn't hang on a slow network
const SIGN_OUT_TIMEOUT_MS = 2000;

// true once this tab's subscription reached the server: the service worker then shows the
// notifications and the in-tab ones are skipped (MessageNotifications)
let active = false;

export const isPushActive = () => active;

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// base64url VAPID key -> bytes for PushManager.subscribe
const decodeKey = (base64url: string) => {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

const sameKey = (current: ArrayBuffer | null | undefined, expected: Uint8Array) => {
  if (!current) {
    return false;
  }
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
};

// Makes sure this browser is subscribed and the server has it, in this locale. Called on every
// page load while notifications are on (it also repairs a subscription the browser dropped, or one
// made with an older key). Returns whether push is active.
export const syncPushSubscription = async (locale: string) => {
  if (!pushSupported() || Notification.permission !== "granted") {
    active = false;
    return false;
  }
  const { data } = await axios.get<{ publicKey: string | null }>("/api/push");
  if (!data.publicKey) {
    active = false; // not configured on this server: in-tab notifications only
    return false;
  }
  const key = decodeKey(data.publicKey);
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe(); // the server's key changed
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  await axios.post("/api/push", { subscription: subscription.toJSON(), locale });
  active = true;
  return true;
};

// Notifications off, or signing out: the server forgets this browser and the browser drops the
// subscription (signing in again subscribes anew). Never throws.
export const removePushSubscription = async () => {
  active = false;
  if (!pushSupported()) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      return;
    }
    await axios
      .delete("/api/push", {
        data: { endpoint: subscription.endpoint },
        timeout: SIGN_OUT_TIMEOUT_MS,
      })
      .catch(() => {
        // the unsubscribe below kills the endpoint anyway; the server drops it on the next send
      });
    await subscription.unsubscribe();
  } catch {
    // nothing more to do
  }
};
