"use client";

import React, { useCallback, useState } from "react";
import { DialogTitle } from "@headlessui/react";
import { FiAlertTriangle } from "react-icons/fi";
import axios from "axios";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import Modal from "@/app/components/modals/Modal";
import Button from "@/app/components/Button";
import useConversation from "@/app/hooks/useConversation";
import { toast } from "react-hot-toast";

interface ConfirmModalProps {
  isOpen?: boolean;
  onClose: () => void;
  // delete: the conversation for every member; leave: a group, for the caller only
  action?: "delete" | "leave";
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  action = "delete",
}) => {
  const t = useTranslations();
  const router = useRouter();
  const { conversationId } = useConversation();
  const [isLoading, setIsLoading] = useState(false);
  const onConfirm = useCallback(() => {
    setIsLoading(true);
    const request =
      action === "leave"
        ? axios.post(`/api/conversations/${conversationId}/leave`)
        : axios.delete(`/api/conversations/${conversationId}`);
    request
      .then(() => {
        onClose();
        router.push("/conversations");
        router.refresh();
      })
      .catch(() => toast.error(t("common.error")))
      .finally(() => setIsLoading(false));
  }, [router, conversationId, onClose, t, action]);

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="sm:flex sm:items-start">
        <div
          className="
             mx-auto
             flex
             h-12
             w-12
             flex-shrink-0
             items-center
             justify-center
             rounded-full
             bg-red-100
             sm:mx-0
             sm:h-10
             sm:w-10">
          <FiAlertTriangle
            className="h-6 w-6 text-red-600"
            aria-hidden="true"
          />
        </div>
        <div
          className="
            mt-3
            text-center
            sm:ml-4
            sm:mt-0
            sm:text-left
        ">
          <DialogTitle
            as="h3"
            className="text-base font-semibold leading-6 text-foreground">
            {action === "leave" ? t("confirm_leave.title") : t("confirm_delete.title")}
          </DialogTitle>
          <div className="mt-2">
            <p className="text-sm text-muted-foreground">
              {action === "leave"
                ? t("confirm_leave.description")
                : t("confirm_delete.description")}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
        <Button disabled={isLoading} danger onClick={onConfirm}>
          {action === "leave" ? t("confirm_leave.confirm") : t("common.delete")}
        </Button>
        <Button disabled={isLoading} secondary onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
