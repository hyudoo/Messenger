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
      // the user is looking at the app: it shows the message (or the inbox badge) itself
      if (windows.some((client) => client.focused)) {
        return;
      }
      await self.registration.showNotification(data.title || "Messenger", {
        body: data.body || "",
        icon: data.icon || "/images/logo.png",
        // one notification per conversation, replaced (and alerting again) on the next message
        tag: data.tag,
        renotify: !!data.tag,
        data: { url: data.url || "/", path: data.path },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url = "/", path } = event.notification.data || {};

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows[0];
      if (open) {
        // an open tab navigates itself (client-side, keeping its locale): MessageNotifications
        await open.focus();
        open.postMessage({ type: "notification:open", path: path || url });
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
