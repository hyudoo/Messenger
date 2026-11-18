"use client";

import axios from "axios";
import React, { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { FieldValues, SubmitHandler, useForm, useWatch } from "react-hook-form";
import { SafeUser } from "@/app/types";

import Input from "../inputs/Input";
import Select from "../inputs/Select";
import Modal from "./Modal";
import Button from "../Button";
import { toast } from "react-hot-toast";

interface GroupChatModalProps {
  isOpen?: boolean;
  onClose: () => void;
  users: SafeUser[];
}

const GroupChatModal: React.FC<GroupChatModalProps> = ({
  isOpen,
  onClose,
  users = [],
}) => {
  const t = useTranslations();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<FieldValues>({
    defaultValues: {
      name: "",
      members: [],
    },
  });

  const members = useWatch({ control, name: "members" });
  const onSubmit: SubmitHandler<FieldValues> = (data) => {
    setIsLoading(true);

    axios
      .post("/api/conversations", {
        ...data,
        isGroup: true,
      })
      .then(() => {
        router.refresh();
        onClose();
      })
      .catch(() => toast.error(t("common.error")))
      .finally(() => setIsLoading(false));
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-12">
          <div className="border-b border-border pb-12">
            <h2
              className="
                 text-base
                 font-semibold
                 leading-7
                 text-foreground
                 ">
              {t("group.title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("group.description")}
            </p>
            <div className="mt-10 flex flex-col gap-y-8">
              <Input
                disabled={isLoading}
                label={t("group.name")}
                id="name"
                errors={errors}
                required
                register={register}
              />
              <Select
                disabled={isLoading}
                label={t("group.members")}
                options={users.map((user) => ({
                  value: user.id,
                  label: user.name,
                }))}
                onChange={(value) =>
                  setValue("members", value, {
                    shouldValidate: true,
                  })
                }
                value={members}
              />
              {/* members are picked from friends (getUsers) */}
              {users.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("group.no_friends")}</p>
              )}
            </div>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-x-6">
          <Button
            disabled={isLoading}
            onClick={onClose}
            type="button"
            secondary>
            {t("common.cancel")}
          </Button>
          <Button disabled={isLoading} type="submit">
            {t("common.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default GroupChatModal;
