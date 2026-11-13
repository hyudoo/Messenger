"use client";

import { Conversation } from "@prisma/client";
import { SafeUser } from "@/app/types";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import useOtherUser from "@/app/hooks/useOtherUser";
import { useIsActive } from "@/app/hooks/useActiveList";

import Avatar from "@/app/components/Avatar";
import AvatarGroup from "@/app/components/AvatarGroup";

interface HeaderProps {
  conversation: Conversation & {
    users: SafeUser[];
  };
}

const Header: React.FC<HeaderProps> = ({ conversation }) => {
  const t = useTranslations("common");
  const otherUser = useOtherUser(conversation);

  const isActive = useIsActive(otherUser?.email);
  const statusText = useMemo(() => {
    if (conversation.isGroup) {
      return t("members", { count: conversation.userIds.length });
    }

    return isActive ? t("online") : t("offline");
  }, [conversation, isActive, t]);
  return (
    <div
      className="
            backdrop-opacity-10
            bg-white/20
            fixed
            w-full
            flex
            sm:px-4
            py-3
            px-4
            lg:px-6
            justify-between
            items-center
            shadow-sm
            ">
      <div className="flex gap-3 items-center">
        {conversation.isGroup ? (
          <AvatarGroup users={conversation.users} />
        ) : (
          <Avatar user={otherUser} />
        )}
        <div className="flex flex-col">
          <div className="text-slate-50">
            {conversation.name || otherUser.name}
          </div>
          <div className="text-sm font-light text-slate-200">{statusText}</div>
        </div>
      </div>
    </div>
  );
};

export default Header;
