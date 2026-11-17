"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { FullMessageType } from "@/app/types";

type SystemMessage = Pick<FullMessageType, "systemType" | "systemName" | "systemUsers"> & {
  sender?: { name: string | null; email: string | null } | null;
};

// The text of a group event (app/libs/system-message.ts) in the reader's language, with
// "You" / "you" for the reader. Empty for a person's message.
const useSystemText = () => {
  const t = useTranslations("system");
  const myEmail = useSession().data?.user?.email;

  return (message: SystemMessage) => {
    if (!message.systemType) {
      return "";
    }
    const isMe = (email?: string | null) => !!email && email === myEmail;
    const actor = isMe(message.sender?.email)
      ? t("you_subject")
      : message.sender?.name || t("someone");
    // documents from before a field existed may lack it
    const users = (message.systemUsers ?? [])
      .map((user) => (isMe(user.email) ? t("you_object") : user.name || t("someone")))
      .join(", ");
    const name = message.systemName ?? "";

    switch (message.systemType) {
      case "created":
        return t("created", { actor, name });
      case "renamed":
        return t("renamed", { actor, name });
      case "added":
        return t("added", { actor, users });
      case "removed":
        return t("removed", { actor, users });
      case "left":
        return t("left", { actor });
    }
  };
};

export default useSystemText;
