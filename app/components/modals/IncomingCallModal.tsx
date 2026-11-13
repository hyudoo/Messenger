"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import Modal from "./Modal";
import Avatar from "../Avatar";
import { HiPhone, HiXMark } from "react-icons/hi2";
import { SafeUser } from "@/app/types";

interface IncomingCallModalProps {
  isOpen?: boolean;
  onClose: () => void;
  user: SafeUser;
  roomId: String;
}

const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  isOpen,
  onClose,
  user,
  roomId,
}) => {
  const t = useTranslations("call");
  const router = useRouter();

  const handleAccept = () => {
    router.push(`/room/${roomId}`);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="grid justify-items-center">
        <Avatar user={user} />
        <h3 className="mt-3 font-bold text-2xl text-center">{user?.name}</h3>
        <h3 className="mt-3 font-bold text-2xl text-center">
          {t("is_calling")}
        </h3>
        <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">
          {t("hint")}
        </p>
        <div>
          <div className="flex gap-14">
            <button
              type="button"
              aria-label={t("decline")}
              className="bg-red-500 p-3 cursor-pointer rounded-full"
              onClick={() => onClose()}>
              <HiXMark size={32} className="text-white" />
            </button>
            <button
              type="button"
              aria-label={t("accept")}
              className="bg-green-500 p-3 cursor-pointer rounded-full"
              onClick={() => handleAccept()}>
              <HiPhone size={32} className="text-white" />
            </button>
          </div>
          <div className="flex gap-11">
            <p>{t("decline")}</p>
            <p>{t("accept")}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default IncomingCallModal;
