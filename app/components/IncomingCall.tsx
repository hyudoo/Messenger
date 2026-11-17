"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { usePathname } from "@/i18n/navigation";
import { getSocket } from "@/app/libs/socket-client";
import { FullCallType } from "@/app/types";
import IncomingCallModal from "./modals/IncomingCallModal";

// Rings for an incoming call on every signed-in page (conversations, people, ...), so it lives in the
// root layout next to ActiveStatus. call:incoming arrives in the user room, which every socket joins on
// connect; the server re-sends calls still ringing whenever a socket (re)connects (server/socket.ts).
// Not on the call screen: the user is already in a call there.
const IncomingCall = () => {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  // kept after closing so the modal's leave transition still has its content
  const [call, setCall] = useState<FullCallType>();
  // the ringing call's room, read by the socket handlers below
  const ringingRoomId = useRef<string | undefined>(undefined);
  // a call arriving during a call is dropped, not left to pop up after hanging up
  const inCall = pathname.startsWith("/room");
  const inCallRef = useRef(inCall);
  useLayoutEffect(() => {
    inCallRef.current = inCall;
  });

  useEffect(() => {
    const socket = getSocket();

    const incomingHandler = (incoming: FullCallType) => {
      if (inCallRef.current) {
        return;
      }
      ringingRoomId.current = incoming.id;
      setCall(incoming);
      setIsOpen(true);
    };

    // declined here or in another tab, or cancelled by the caller: stop ringing
    const stopRingingHandler = (payload: { roomId?: unknown }) => {
      if (payload?.roomId === ringingRoomId.current) {
        ringingRoomId.current = undefined;
        setIsOpen(false);
      }
    };

    socket.on("call:incoming", incomingHandler);
    socket.on("call:declined", stopRingingHandler);
    socket.on("call:cancelled", stopRingingHandler);
    return () => {
      socket.off("call:incoming", incomingHandler);
      socket.off("call:declined", stopRingingHandler);
      socket.off("call:cancelled", stopRingingHandler);
    };
  }, []);

  if (!call || inCall) {
    return null;
  }

  return (
    <IncomingCallModal
      user={call.user}
      roomId={call.id}
      callType={call.callType}
      isOpen={isOpen}
      onClose={() => {
        ringingRoomId.current = undefined;
        setIsOpen(false);
      }}
    />
  );
};

export default IncomingCall;
