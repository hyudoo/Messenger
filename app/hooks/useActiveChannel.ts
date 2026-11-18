import { useEffect } from "react";
import { useSession } from "next-auth/react";

import { getSocket } from "../libs/socket-client";
import useActiveList from "./useActiveList";

// Opens the shared socket connection once the user is signed in and keeps the
// online list (emails) in sync with the server's presence events.
const useActiveChannel = () => {
  const { set, add, remove } = useActiveList();
  const { status } = useSession();

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
    socket.connect();

    return () => {
      socket.off("presence:list", set);
      socket.off("contacts:update", resync);
      socket.off("presence:online", add);
      socket.off("presence:offline", remove);
      socket.disconnect();
    };
  }, [status, set, add, remove]);
};

export default useActiveChannel;
