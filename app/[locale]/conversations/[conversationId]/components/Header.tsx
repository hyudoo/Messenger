"use client";

import { HiChevronLeft } from "react-icons/hi";
import { HiEllipsisHorizontal, HiPhone, HiVideoCamera } from "react-icons/hi2";
import { useMemo, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Conversation } from "@prisma/client";
import { SafeUser } from "@/app/types";
import axios from "axios";
import { toast } from "react-hot-toast";

import useOtherUser from "@/app/hooks/useOtherUser";
import usePresenceText from "@/app/hooks/usePresenceText";

import Avatar from "@/app/components/Avatar";
import AvatarGroup from "@/app/components/AvatarGroup";
import ProfileDrawer from "./ProfileDrawer";
import { Link, useRouter } from "@/i18n/navigation";

interface HeaderProps {
  conversation: Conversation & {
    users: SafeUser[];
  };
  // everyone but the user (groups: who can be added)
  users: SafeUser[];
  // the user's own settings of this conversation
  settings: { muted: boolean; pinned: boolean };
}

const Header: React.FC<HeaderProps> = ({ conversation, users, settings }) => {
  const t = useTranslations();
  const router = useRouter();
  const otherUser = useOtherUser(conversation);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 1:1: "Active now", "Active 5 minutes ago" or "Offline"
  const presenceText = usePresenceText(otherUser);
  const statusText = conversation.isGroup
    ? t("common.members", { count: conversation.userIds.length })
    : presenceText;

  // const handleCall = useCallback(() => {
  //   axios.post("/api/messages", {
  //     isCall: true,
  //     conversationId: conversation.id,
  //   });
  //   router.push(`/room/${conversation.id}`);
  // }, [conversation, router]);

  // The call message is what rings the callee (call:incoming): if it fails (rate limit, server
  // error) nobody would ring, so say so instead of leaving the caller waiting in an empty room.
  // The room reads the kind back from this call message (getCallType).
  const handleCall = useCallback(
    async (callType: "audio" | "video") => {
      try {
        await axios.post("/api/messages", {
          isCall: true,
          callType,
          conversationId: conversation.id,
        });
        router.push(`/room/${conversation.id}`);
      } catch {
        toast.error(t("common.error"));
      }
    },
    [conversation, router, t]
  );

  return (
    <>
      <ProfileDrawer
        data={conversation}
        users={users}
        settings={settings}
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
                text-sky-500
                transition
                cursor-pointer
                ">
            <HiChevronLeft size={32} />
          </Link>
          {conversation.isGroup ? (
            <AvatarGroup users={conversation.users} />
          ) : (
            <Avatar user={otherUser} />
          )}
          <div className="flex flex-col">
            <div>{conversation.name || otherUser.name}</div>
            <div className="text-sm font-light text-muted-foreground">
              {statusText}
            </div>
          </div>
        </div>
        <div className="flex gap-4">
          {!conversation.isGroup && (
            <>
              <button
                type="button"
                aria-label={t("chat.audio_call")}
                title={t("chat.audio_call")}
                onClick={() => handleCall("audio")}
                className="text-sky-500 transition hover:text-sky-600">
                <HiPhone size={28} />
              </button>
              <button
                type="button"
                aria-label={t("chat.video_call")}
                title={t("chat.video_call")}
                onClick={() => handleCall("video")}
                className="text-sky-500 transition hover:text-sky-600">
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
            className="rounded-full text-sky-500 transition hover:text-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            <HiEllipsisHorizontal size={32} aria-hidden />
          </button>
        </div>
      </div>
    </>
  );
};

export default Header;
