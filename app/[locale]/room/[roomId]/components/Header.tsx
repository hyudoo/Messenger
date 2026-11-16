"use client";

import { Conversation } from "@prisma/client";
import { SafeUser } from "@/app/types";
import { FaMicrophoneSlash } from "react-icons/fa";
import { useTranslations } from "next-intl";

import useOtherUser from "@/app/hooks/useOtherUser";

import Avatar from "@/app/components/Avatar";
import AvatarGroup from "@/app/components/AvatarGroup";

interface HeaderProps {
  conversation: Conversation & {
    users: SafeUser[];
  };
  // call status, or the call duration once connected
  status: React.ReactNode;
  remoteMuted: boolean;
}

const Header: React.FC<HeaderProps> = ({
  conversation,
  status,
  remoteMuted,
}) => {
  const t = useTranslations("call");
  const otherUser = useOtherUser(conversation);

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] lg:px-6">
      {conversation.isGroup ? (
        <AvatarGroup users={conversation.users} />
      ) : (
        <Avatar user={otherUser} />
      )}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2 font-medium text-white">
          <span className="truncate">
            {conversation.name || otherUser.name}
          </span>
          {remoteMuted && (
            <FaMicrophoneSlash
              size={14}
              className="shrink-0 text-red-400"
              aria-label={t("muted")}
            />
          )}
        </div>
        <div className="text-sm tabular-nums text-white/70" aria-live="polite">
          {status}
        </div>
      </div>
    </div>
  );
};

export default Header;
