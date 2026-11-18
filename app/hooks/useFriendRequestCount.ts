import { useEffect } from "react";
import { create } from "zustand";
import axios from "axios";

import { getSocket } from "@/app/libs/socket-client";

// How many friend requests wait for the user: the badge on "Contacts" (desktop sidebar and mobile
// footer). Loaded once for every component using it (GET /api/friends/requests), again when
// friends change on either side (contacts:update with `friends`) and after a socket reconnect.
const useCountStore = create<{ count: number; set: (count: number) => void }>((set) => ({
  count: 0,
  set: (count) => set({ count }),
}));

let users = 0;
let detach: (() => void) | null = null;

const load = () =>
  axios
    .get<{ incoming: number }>("/api/friends/requests")
    .then(({ data }) => useCountStore.getState().set(data.incoming))
    .catch(() => undefined);

const attach = () => {
  const socket = getSocket();
  const changed = (payload: { friends?: boolean }) => {
    if (payload?.friends) {
      void load();
    }
  };
  void load();
  socket.on("contacts:update", changed);
  socket.on("connect", load);
  return () => {
    socket.off("contacts:update", changed);
    socket.off("connect", load);
  };
};

const useFriendRequestCount = () => {
  useEffect(() => {
    users += 1;
    if (users === 1) {
      detach = attach();
    }
    return () => {
      users -= 1;
      if (users === 0) {
        detach?.();
        detach = null;
      }
    };
  }, []);
  return useCountStore((state) => state.count);
};

export default useFriendRequestCount;
