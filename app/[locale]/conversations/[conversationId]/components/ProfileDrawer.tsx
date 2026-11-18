"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { IoClose, IoExitOutline, IoTrash } from "react-icons/io5";
import {
  HiBell,
  HiBellSlash,
  HiMagnifyingGlass,
  HiOutlineMapPin,
  HiMapPin,
} from "react-icons/hi2";
import axios from "axios";
import { toast } from "react-hot-toast";
import { useSession } from "next-auth/react";
import { Conversation } from "@prisma/client";
import { SafeUser } from "@/app/types";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

import useDateLocale from "@/app/hooks/useDateLocale";

import useOtherUser from "@/app/hooks/useOtherUser";
import {
  canDeleteConversation,
  canLeaveConversation,
} from "@/app/libs/conversation-permissions";
import usePresenceText from "@/app/hooks/usePresenceText";

import Avatar from "@/app/components/Avatar";
import AvatarGroup from "@/app/components/AvatarGroup";
import ConfirmModal from "./ConfirmModal";
import ConversationSearch from "./ConversationSearch";
import { getSocket } from "@/app/libs/socket-client";
import { useRouter } from "@/i18n/navigation";
import type { Relation } from "@/app/libs/friends";
import { HiArchiveBox, HiNoSymbol, HiUserGroup, HiUserPlus } from "react-icons/hi2";
import { ConversationSettings } from "@/app/types";
import { GroupInvite, GroupMembers, GroupName, GroupPhoto } from "./GroupSettings";

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  data: Conversation & {
    users: SafeUser[];
  };
  // everyone but the user (groups: who can be added)
  users: SafeUser[];
  // the user's own settings of this conversation (from the page; kept live below)
  settings: { muted: boolean; pinned: boolean; archived: boolean };
  // 1:1: whether the user blocked the other one / either blocked the other
  blockedByMe: boolean;
  blocked: boolean;
  // 1:1: how the user stands with the other one
  friendRelation: Relation;
}

const ProfileDrawer: React.FC<ProfileDrawerProps> = ({
  isOpen,
  onClose,
  data,
  users,
  settings: initialSettings,
  blockedByMe,
  blocked,
  friendRelation,
}) => {
  const t = useTranslations();
  const dateLocale = useDateLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // kept after closing, so the modal's text doesn't change while it fades out
  const [confirmAction, setConfirmAction] = useState<"delete" | "leave">("delete");
  const openConfirm = (action: "delete" | "leave") => {
    setConfirmAction(action);
    setConfirmOpen(true);
  };
  const [searching, setSearching] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [savingSetting, setSavingSetting] = useState(false);
  // another tab (or the inbox) changed them
  useEffect(() => {
    const socket = getSocket();
    const handler = (update: ConversationSettings) => {
      if (update.id === data.id) {
        setSettings({ muted: update.muted, pinned: update.pinned, archived: update.archived });
      }
    };
    socket.on("conversation:settings", handler);
    return () => {
      socket.off("conversation:settings", handler);
    };
  }, [data.id]);

  const changeSetting = (change: Partial<typeof settings>) => {
    setSavingSetting(true);
    axios
      .patch<ConversationSettings>(`/api/conversations/${data.id}/settings`, change)
      .then(({ data: saved }) =>
        setSettings({ muted: saved.muted, pinned: saved.pinned, archived: saved.archived })
      )
      .catch((error) =>
        toast.error(
          error?.response?.status === 409 ? t("profile.pin_limit") : t("common.error")
        )
      )
      .finally(() => setSavingSetting(false));
  };

  // blocking (1:1): two clicks, the second confirms; the page reloads with the new state
  const router = useRouter();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const toggleBlock = () => {
    if (!blockedByMe && !confirmBlock) {
      setConfirmBlock(true);
      setTimeout(() => setConfirmBlock(false), 3000);
      return;
    }
    setConfirmBlock(false);
    setSavingSetting(true);
    axios
      .post(`/api/users/${otherUser.id}/block`, { blocked: !blockedByMe })
      .then(() => router.refresh())
      .catch(() => toast.error(t("block.failed")))
      .finally(() => setSavingSetting(false));
  };

  // 1:1 "Add friend" (or "Accept" when they asked: the same request accepts theirs); the page
  // reloads with the new state, also when the other side answers (contacts:update)
  const [befriending, setBefriending] = useState(false);
  const addFriend = () => {
    setBefriending(true);
    axios
      .post(`/api/friends/requests`, { userId: otherUser.id })
      .then(() => router.refresh())
      .catch((error) =>
        toast.error(error?.response?.status === 429 ? t("users.too_fast") : t("users.failed"))
      )
      .finally(() => setBefriending(false));
  };
  useEffect(() => {
    if (data.isGroup) {
      return;
    }
    const socket = getSocket();
    const changed = (payload: { friends?: boolean }) => payload?.friends && router.refresh();
    socket.on("contacts:update", changed);
    return () => {
      socket.off("contacts:update", changed);
    };
  }, [data.isGroup, router]);
  const friendLabel =
    friendRelation === "friend"
      ? t("users.friends_badge")
      : friendRelation === "outgoing"
        ? t("users.requested")
        : friendRelation === "incoming"
          ? t("users.accept_request")
          : t("users.add_friend");
  const canBefriend = friendRelation === "none" || friendRelation === "incoming";

  const close = () => {
    onClose();
    // after the closing slide
    setTimeout(() => setSearching(false), 500);
  };

  const otherUser = useOtherUser(data);
  const myEmail = useSession().data?.user?.email;
  const myId = data.users.find((user) => user.email === myEmail)?.id;
  // the same rules as the API (a group: leave; delete only by its owner)
  const canDelete = !!myId && canDeleteConversation(data, myId);
  const canLeave = canLeaveConversation(data);

  const joinedDate = useMemo(() => {
    return format(new Date(otherUser.createdAt), "PP", { locale: dateLocale });
  }, [otherUser.createdAt, dateLocale]);

  const title = useMemo(() => {
    return data.name || otherUser.name;
  }, [data.name, otherUser.name]);

  // 1:1: "Active now", "Active 5 minutes ago" or "Offline"
  const presenceText = usePresenceText(otherUser);
  const statusText = data.isGroup
    ? t("common.members", { count: data.users.length })
    : presenceText;
  return (
    <>
      <ConfirmModal
        isOpen={confirmOpen}
        action={confirmAction}
        onClose={() => setConfirmOpen(false)}
      />
      <Transition show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={close}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-500"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-500"
            leaveFrom="opacity-100"
            leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black bg-opacity-40" />
          </TransitionChild>
          <div className="fixed inset-0 overflow-hidden">
            <div className="absolute inset-0 overflow-hidden">
              <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
                <TransitionChild
                  as={Fragment}
                  enter="transform transition ease-in-out duration-500"
                  enterFrom="translate-x-full"
                  enterTo="translate-x-0"
                  leave="transform transition ease-in-out duration-500"
                  leaveFrom="translate-x-0"
                  leaveTo="translate-x-full">
                  <DialogPanel className="pointer-events-auto w-screen max-w-md">
                    <div className="flex h-full flex-col overflow-y-scroll bg-background py-6 shadow-xl">
                      <div className="px-4 sm:px-6">
                        <div className="flex items-start justify-end">
                          <div className="ml-3 flex h-7 items-center">
                            <button
                              type="button"
                              className="rounded-md bg-background text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                              onClick={close}>
                              <span className="sr-only">{t("profile.close")}</span>
                              <IoClose size={24} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                      {searching ? (
                        <div className="relative mt-2 min-h-0 flex-1 px-4 sm:px-6">
                          <ConversationSearch
                            conversationId={data.id}
                            onBack={() => setSearching(false)}
                            onPick={close}
                          />
                        </div>
                      ) : (
                      <div className="relative mt-6 flex-1 px-4 sm:px-6">
                        <div className="flex flex-col items-center">
                          <div className="mb-2">
                            {data.isGroup ? (
                              <GroupPhoto conversation={data} />
                            ) : (
                              <Avatar user={otherUser} />
                            )}
                          </div>
                          {data.isGroup ? <GroupName conversation={data} /> : <div>{title}</div>}
                          <div className="text-sm text-muted-foreground">
                            {statusText}
                          </div>
                          <div className="my-8 flex flex-wrap justify-center gap-x-8 gap-y-4">
                            <button
                              type="button"
                              onClick={() => setSearching(true)}
                              className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75">
                              <span className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                                <HiMagnifyingGlass size={20} aria-hidden />
                              </span>
                              <span className="text-sm font-light text-muted-foreground">
                                {t("profile.search")}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={savingSetting}
                              aria-pressed={settings.muted}
                              onClick={() => changeSetting({ muted: !settings.muted })}
                              className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75 disabled:opacity-50">
                              <span className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                                {settings.muted ? <HiBellSlash size={20} aria-hidden /> : <HiBell size={20} aria-hidden />}
                              </span>
                              <span className="text-sm font-light text-muted-foreground">
                                {settings.muted ? t("profile.unmute") : t("profile.mute")}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={savingSetting}
                              aria-pressed={settings.pinned}
                              onClick={() => changeSetting({ pinned: !settings.pinned })}
                              className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75 disabled:opacity-50">
                              <span className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                                {settings.pinned ? <HiMapPin size={20} aria-hidden /> : <HiOutlineMapPin size={20} aria-hidden />}
                              </span>
                              <span className="text-sm font-light text-muted-foreground">
                                {settings.pinned ? t("profile.unpin") : t("profile.pin")}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={savingSetting}
                              aria-pressed={settings.archived}
                              onClick={() => changeSetting({ archived: !settings.archived })}
                              className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75 disabled:opacity-50">
                              <span className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                                <HiArchiveBox size={20} aria-hidden />
                              </span>
                              <span className="text-sm font-light text-muted-foreground">
                                {settings.archived ? t("profile.unarchive") : t("profile.archive")}
                              </span>
                            </button>
                            {canLeave && (
                              <button
                                type="button"
                                onClick={() => openConfirm("leave")}
                                className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75">
                                <span className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                                  <IoExitOutline size={20} aria-hidden />
                                </span>
                                <span className="text-sm font-light text-muted-foreground">
                                  {t("profile.leave")}
                                </span>
                              </button>
                            )}
                            {!data.isGroup && !blocked && (
                              <button
                                type="button"
                                disabled={!canBefriend || befriending}
                                onClick={addFriend}
                                className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75 disabled:cursor-default disabled:hover:opacity-100">
                                <span
                                  className={
                                    friendRelation === "friend"
                                      ? "w-10 h-10 rounded-full flex items-center justify-center bg-sky-500/15 text-sky-500"
                                      : "w-10 h-10 bg-muted rounded-full flex items-center justify-center"
                                  }>
                                  {friendRelation === "friend" ? (
                                    <HiUserGroup size={20} aria-hidden />
                                  ) : (
                                    <HiUserPlus size={20} aria-hidden />
                                  )}
                                </span>
                                <span className="text-sm font-light text-muted-foreground">
                                  {friendLabel}
                                </span>
                              </button>
                            )}
                            {!data.isGroup && (
                              <button
                                type="button"
                                disabled={savingSetting}
                                onClick={toggleBlock}
                                className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75 disabled:opacity-50">
                                <span
                                  className={
                                    confirmBlock
                                      ? "w-10 h-10 rounded-full flex items-center justify-center bg-rose-500 text-white"
                                      : "w-10 h-10 bg-muted rounded-full flex items-center justify-center"
                                  }>
                                  <HiNoSymbol size={20} aria-hidden />
                                </span>
                                <span className="text-sm font-light text-muted-foreground">
                                  {blockedByMe
                                    ? t("block.unblock")
                                    : confirmBlock
                                      ? t("block.confirm")
                                      : t("block.block")}
                                </span>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => openConfirm("delete")}
                                className="flex flex-col gap-3 items-center cursor-pointer hover:opacity-75">
                                <span className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                                  <IoTrash size={20} aria-hidden />
                                </span>
                                <span className="text-sm font-light text-muted-foreground">
                                  {t("profile.delete")}
                                </span>
                              </button>
                            )}
                          </div>
                          {data.isGroup ? (
                            <div className="w-full">
                              <GroupInvite conversation={data} myId={myId} />
                              <GroupMembers conversation={data} myId={myId} users={users} />
                            </div>
                          ) : (
                            <dl className="w-full space-y-6 px-4 sm:px-6">
                              <div>
                                <dt className="text-sm font-medium text-muted-foreground">
                                  {t("profile.email")}
                                </dt>
                                <dd className="mt-1 text-sm text-foreground">{otherUser.email}</dd>
                              </div>
                              <hr />
                              <div>
                                <dt className="text-sm font-medium text-muted-foreground">
                                  {t("profile.joined")}
                                </dt>
                                <dd className="mt-1 text-sm text-foreground">
                                  <time dateTime={new Date(otherUser.createdAt).toISOString()}>
                                    {joinedDate}
                                  </time>
                                </dd>
                              </div>
                            </dl>
                          )}
                        </div>
                      </div>
                      )}
                    </div>
                  </DialogPanel>
                </TransitionChild>
              </div>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
};

export default ProfileDrawer;
