import webpush from "web-push";

import prisma from "@/app/libs/prismadb";
import { logWarn } from "@/app/libs/log";

// Web Push (notifications with the tab closed). Off unless VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are
// set (`npx web-push generate-vapid-keys`). The browser side is app/libs/push-client.ts and
// public/sw.js; subscriptions are stored by /api/push.

// a notification this old is no longer worth showing
const PUSH_TTL_SECONDS = 12 * 60 * 60;
// a user's browsers kept; older subscriptions are dropped when a new one comes in
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

// The endpoint is a URL the browser hands us and the server POSTs to, so only real push services
// are accepted (otherwise a client could make the server send requests anywhere).
const PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Opera, Samsung
  "android.googleapis.com",
  ".push.services.mozilla.com", // Firefox
  ".notify.windows.com", // Edge
  ".push.apple.com", // Safari
];

export const isPushEndpoint = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      PUSH_HOSTS.some((host) =>
        host.startsWith(".") ? url.hostname.endsWith(host) : url.hostname === host
      )
    );
  } catch {
    return false;
  }
};

export const getVapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;

let configuredWith: string | null = null;

const configure = () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return false;
  }
  if (configuredWith !== publicKey) {
    // push services want a contact: mailto: or an https URL
    const subject =
      process.env.VAPID_SUBJECT ||
      (process.env.NEXTAUTH_URL?.startsWith("https://")
        ? process.env.NEXTAUTH_URL
        : "https://localhost");
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configuredWith = publicKey;
  }
  return true;
};

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  // one notification per tag: the next one replaces it
  tag: string;
  // opened when there is no tab (with the locale) / pushed in an open tab (without it)
  url: string;
  path: string;
  // calls: stays on screen until clicked / closed ...
  requireInteraction?: boolean;
  // ... or until the ringing ends (ms since the epoch); not shown at all after that
  expiresAt?: number;
}

// Sends a notification to every browser of these users, written in each subscription's locale.
// Never throws; subscriptions the push service says are gone are deleted.
export const sendPush = async (
  userIds: string[],
  build: (locale: string) => PushPayload,
  { topic, ttlSeconds = PUSH_TTL_SECONDS }: { topic?: string; ttlSeconds?: number } = {}
) => {
  if (userIds.length === 0 || !configure()) {
    return;
  }
  try {
    const subscriptions = await prisma.webPushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
    const gone: string[] = [];
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify(build(subscription.locale)),
            // topic: a newer push for the same conversation replaces one still queued
            { TTL: ttlSeconds, urgency: "high", ...(topic && { topic }) }
          );
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            gone.push(subscription.id);
          } else {
            // the endpoint is a capability URL: log its host only
            logWarn("push.send", error, { status, host: new URL(subscription.endpoint).host });
          }
        }
      })
    );
    if (gone.length > 0) {
      await prisma.webPushSubscription.deleteMany({ where: { id: { in: gone } } });
    }
  } catch (error) {
    logWarn("push.send", error);
  }
};
