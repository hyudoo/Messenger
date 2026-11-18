// Service worker for Web Push (app/libs/push-client.ts registers it, app/libs/web-push.ts sends).
// It does nothing else: no caching, no fetch handler.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // not JSON: shown with the defaults below
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // the user is looking at the app: it shows the message (or rings the call) itself
      if (windows.some((client) => client.focused)) {
        return;
      }
      // a call that stopped ringing before the push arrived
      const ringsFor = data.expiresAt ? data.expiresAt - Date.now() : null;
      if (ringsFor !== null && ringsFor <= 0) {
        return;
      }
      await self.registration.showNotification(data.title || "Messenger", {
        body: data.body || "",
        icon: data.icon || "/images/logo.png",
        // one notification per conversation (per call), replaced (and alerting again) by the next
        tag: data.tag,
        renotify: !!data.tag,
        requireInteraction: !!data.requireInteraction,
        // a ringing call: "Answer" / "Decline" (titles in the user's language, from the server)
        ...(Array.isArray(data.actions) && { actions: data.actions.slice(0, 2) }),
        data: {
          url: data.url || "/",
          path: data.path,
          expiresAt: data.expiresAt,
          answerUrl: data.answerUrl,
          answerPath: data.answerPath,
          declineUrl: data.declineUrl,
        },
      });
      // a ringing call goes away when the ringing ends (if it wasn't replaced by "missed" already)
      if (ringsFor !== null) {
        await new Promise((resolve) => setTimeout(resolve, ringsFor));
        const shown = await self.registration.getNotifications({ tag: data.tag });
        shown
          .filter((notification) => notification.data && notification.data.expiresAt === data.expiresAt)
          .forEach((notification) => notification.close());
      }
    })()
  );
});

// Opens a path in the app: an open tab navigates itself (client-side, keeping its locale:
// MessageNotifications), else a new window opens the full URL.
const openInApp = async (url, path) => {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows[0];
  if (open) {
    await open.focus();
    open.postMessage({ type: "notification:open", path: path || url });
    return;
  }
  await self.clients.openWindow(url);
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const { url = "/", path } = data;
  const ringing = !!data.expiresAt && data.expiresAt > Date.now();

  event.waitUntil(
    (async () => {
      // "Decline" on a ringing call: no window needed (the session cookie goes along)
      if (event.action === "decline" && data.declineUrl) {
        if (ringing) {
          await fetch(data.declineUrl, { method: "POST", credentials: "same-origin" }).catch(
            () => undefined
          );
        }
        return;
      }
      // "Answer": straight into the call room (once it stopped ringing: the chat, like a click)
      if (event.action === "answer" && data.answerUrl && ringing) {
        await openInApp(data.answerUrl, data.answerPath);
        return;
      }
      await openInApp(url, path);
    })()
  );
});
