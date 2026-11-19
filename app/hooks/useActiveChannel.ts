import { useEffect } from "react";
import { getSession, signOut, useSession } from "next-auth/react";
import { useLocale } from "next-intl";

import { removePushSubscription } from "../libs/push-client";
import { getSocket } from "../libs/socket-client";
import useActiveList from "./useActiveList";

// Opens the shared socket connection once the user is signed in and keeps the
// online list (emails) in sync with the server's presence events.
const useActiveChannel = () => {
  const { set, add, remove } = useActiveList();
  const { status } = useSession();
  const locale = useLocale();

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    const socket = getSocket();
    // friends or shared conversations changed: whose presence this user sees changed too
    const resync = () => socket.emit("presence:sync");
    socket.on("presence:list", set);
    socket.on("contacts:update", resync);
    socket.on("presence:online", add);
    socket.on("presence:offline", remove);
    // Refused at (re)connect: this session may have been ended from another device (a password
    // change or "sign out other devices", app/libs/session-version.ts). Signed out for real: go to
    // the login page. Still signed in (e.g. this device's own new cookie arrived late): try again.
    let retry: ReturnType<typeof setTimeout> | undefined;
    const onConnectError = async (error: Error) => {
      if (error.message !== "Unauthorized") {
        return;
      }
      const session = await getSession().catch(() => undefined);
      if (session === null) {
        // the server already forgot this browser's push subscription (revokeSessions); drop it
        // here too, like a sign-out from the menu
        await removePushSubscription();
        void signOut({ callbackUrl: `/${locale}` });
      } else {
        clearTimeout(retry);
        retry = setTimeout(() => socket.connect(), 3000);
      }
    };
    socket.on("connect_error", onConnectError);
    socket.connect();

    return () => {
      socket.off("presence:list", set);
      socket.off("contacts:update", resync);
      socket.off("presence:online", add);
      socket.off("presence:offline", remove);
      socket.off("connect_error", onConnectError);
      clearTimeout(retry);
      socket.disconnect();
    };
  }, [status, locale, set, add, remove]);
};

export default useActiveChannel;
