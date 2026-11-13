"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
          đang gọi cho bạn.
        </h3>
        <p className="mt-2 mb-5 text-sm leading-6 text-gray-600">
          Cuộc gọi sẽ bắt đầu ngay sau khi bạn chấp nhận
        </p>
        <div>
          <div className="flex gap-14">
            <div
              className="bg-red-500 p-3 cursor-pointer rounded-full"
              onClick={() => onClose()}>
              <HiXMark size={32} className="text-white" />
            </div>
            <div
              className="bg-green-500 p-3 cursor-pointer rounded-full"
              onClick={() => handleAccept()}>
              <HiPhone size={32} className="text-white" />
            </div>
          </div>
          <div className="flex gap-11">
            <p>Từ chối</p>
            <p>Chấp nhận</p>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default IncomingCallModal;
