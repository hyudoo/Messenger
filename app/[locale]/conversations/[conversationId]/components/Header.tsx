"use client";

import { HiChevronLeft } from "react-icons/hi";
import { HiEllipsisHorizontal, HiPhone, HiVideoCamera } from "react-icons/hi2";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Conversation } from "@prisma/client";
import { SafeUser } from "@/app/types";

import useOtherUser from "@/app/hooks/useOtherUser";
import usePresenceText from "@/app/hooks/usePresenceText";
import useStartCall from "@/app/hooks/useStartCall";

import Avatar from "@/app/components/Avatar";
import AvatarGroup from "@/app/components/AvatarGroup";
import ProfileDrawer from "./ProfileDrawer";
import { displayName } from "@/app/libs/nicknames";
import type { Relation } from "@/app/libs/friends";
import { Link } from "@/i18n/navigation";

interface HeaderProps {
  conversation: Conversation & {
    users: SafeUser[];
  };
  // everyone but the user (groups: who can be added)
  users: SafeUser[];
  // the user's own settings of this conversation
  settings: { muted: boolean; pinned: boolean; archived: boolean };
  // a 1:1 chat where the user blocked the other one / where either blocked the other (no calls)
  blockedByMe: boolean;
  blocked: boolean;
  // 1:1: friends / asked / they asked / none
  friendRelation: Relation;
}

const Header: React.FC<HeaderProps> = ({
  conversation,
  users,
  settings,
  blockedByMe,
  blocked,
  friendRelation,
}) => {
  const t = useTranslations();
  const otherUser = useOtherUser(conversation);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 1:1: "Active now", "Active 5 minutes ago" or "Offline"
  const presenceText = usePresenceText(otherUser);
  const statusText = conversation.isGroup
    ? t("common.members", { count: conversation.userIds.length })
    : presenceText;

  // starts a call, or joins the group call going on
  const handleCall = useStartCall(conversation.id);

  return (
    <>
      <ProfileDrawer
        data={conversation}
        users={users}
        settings={settings}
        blockedByMe={blockedByMe}
        blocked={blocked}
        friendRelation={friendRelation}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <div
        className="
            bg-background
            w-full
            flex
            border-b-[1px]
            sm:px-4
            py-3
            px-4
            lg:px-6
            justify-between
            items-center
            shadow-sm
            ">
        <div className="flex gap-3 items-center">
          <Link
            href="/conversations"
            aria-label={t("chat.back")}
            className="
                lg:hidden
                block
                text-chat
                transition
                cursor-pointer
                ">
            <HiChevronLeft size={32} />
          </Link>
          {conversation.isGroup ? (
            <AvatarGroup users={conversation.users} image={conversation.image} />
          ) : (
            <Avatar user={otherUser} />
          )}
          <div className="flex flex-col">
            <div>{conversation.name || displayName(otherUser, conversation.nicknames)}</div>
            <div className="text-sm font-light text-muted-foreground">
              {statusText}
            </div>
          </div>
        </div>
        <div className="flex gap-4">
          {/* groups call too (a mesh of up to MAX_GROUP_CALL_PEERS, app/libs/call-mesh.ts) */}
          {!blocked && (
            <>
              <button
                type="button"
                aria-label={t("chat.audio_call")}
                title={t("chat.audio_call")}
                onClick={() => handleCall("audio")}
                className="text-chat transition hover:text-chat/80">
                <HiPhone size={28} />
              </button>
              <button
                type="button"
                aria-label={t("chat.video_call")}
                title={t("chat.video_call")}
                onClick={() => handleCall("video")}
                className="text-chat transition hover:text-chat/80">
                <HiVideoCamera size={32} />
              </button>
            </>
          )}
          <button
            type="button"
            aria-label={t("chat.details")}
            title={t("chat.details")}
            aria-haspopup="dialog"
            onClick={() => setDrawerOpen(true)}
            className="rounded-full text-chat transition hover:text-chat/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-chat">
            <HiEllipsisHorizontal size={32} aria-hidden />
          </button>
        </div>
      </div>
    </>
  );
};

export default Header;
