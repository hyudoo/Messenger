"use client";

import React, { useEffect, useLayoutEffect, useRef } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { HiPhone, HiVideoCamera, HiXMark } from "react-icons/hi2";

import { useRouter } from "@/i18n/navigation";
import { CallType } from "@prisma/client";
import { SafeUser } from "@/app/types";
import useCallTone from "@/app/hooks/useCallTone";
import { getSocket } from "@/app/libs/socket-client";
import { CALL_RING_TIMEOUT_MS } from "@/app/libs/call";
import Modal from "./Modal";

interface IncomingCallModalProps {
  isOpen?: boolean;
  onClose: () => void;
  user: SafeUser;
  roomId: String;
  callType?: CallType | null;
  // a group call: shown under the caller's name
  groupName?: string | null;
}

const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  isOpen,
  onClose,
  user,
  roomId,
  callType,
  groupName,
}) => {
  const t = useTranslations("call");
  const tCommon = useTranslations("common");
  const router = useRouter();

  useCallTone("ringtone", !!isOpen);

  // onClose is a new function on every parent render; the timer must not restart
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const id = setTimeout(() => onCloseRef.current(), CALL_RING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [isOpen, roomId]);

  // tells the caller (1:1) and our other tabs; they close on call:declined
  const handleDecline = () => {
    getSocket().emit("call:decline", String(roomId));
    onClose();
  };

  const handleAccept = () => {
    router.push(`/room/${roomId}`);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col items-center px-2 pb-2 pt-4 text-center">
        <div className="relative h-24 w-24">
          <span className="absolute inset-0 animate-ping rounded-full bg-green-500/25" />
          <div className="relative h-full w-full overflow-hidden rounded-full ring-4 ring-green-500/30">
            <Image
              fill
              sizes="96px"
              className="object-cover"
              src={user?.image || "/images/placeholder.jpg"}
              alt={tCommon("avatar")}
            />
          </div>
        </div>

        <p className="mt-6 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {callType === "audio" ? (
            <HiPhone size={16} aria-hidden />
          ) : (
            <HiVideoCamera size={16} aria-hidden />
          )}
          {t("incoming", { kind: callType ?? "video" })}
        </p>
        <h3 className="mt-1 max-w-full truncate text-2xl font-semibold text-foreground">
          {user?.name}
        </h3>
        {groupName && (
          <p className="mt-1 max-w-full truncate text-sm font-medium text-foreground">
            {t("in_group", { name: groupName })}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{t("hint")}</p>

        <div className="mt-8 grid grid-cols-2 gap-12">
          <button
            type="button"
            className="group flex flex-col items-center gap-2 text-sm text-foreground focus-visible:outline-none"
            onClick={handleDecline}>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 transition group-hover:bg-red-600 group-focus-visible:ring-4 group-focus-visible:ring-red-500/40 group-active:scale-95">
              <HiXMark size={30} aria-hidden />
            </span>
            {t("decline")}
          </button>
          <button
            type="button"
            className="group flex flex-col items-center gap-2 text-sm text-foreground focus-visible:outline-none"
            onClick={handleAccept}>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lg shadow-green-500/30 transition group-hover:bg-green-600 group-focus-visible:ring-4 group-focus-visible:ring-green-500/40 group-active:scale-95">
              <HiPhone size={28} className="animate-pulse" aria-hidden />
            </span>
            {t("accept")}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default IncomingCallModal;
