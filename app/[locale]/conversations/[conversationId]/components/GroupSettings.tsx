"use client";

import axios from "axios";
import clsx from "clsx";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "react-hot-toast";
import { useLocale, useTranslations } from "next-intl";
import {
  HiCamera,
  HiCheck,
  HiLink,
  HiOutlineShieldCheck,
  HiPencil,
  HiShieldCheck,
  HiUserPlus,
  HiXMark,
} from "react-icons/hi2";

import Avatar from "@/app/components/Avatar";
import AvatarGroup from "@/app/components/AvatarGroup";
import ImageUploadButton from "@/app/components/ImageUploadButton";
import SearchInput from "@/app/components/inputs/SearchInput";
import {
  MAX_GROUP_NAME_LENGTH,
  canEditGroup,
  canManageAdmins,
  canManageInvite,
  canRemoveMember,
} from "@/app/libs/conversation-permissions";
import { invitePath } from "@/app/libs/invite-code";
import { matchesSearch } from "@/app/libs/search";
import { ConversationWithUsers, SafeUser } from "@/app/types";
import { getSocket } from "@/app/libs/socket-client";
import { useRouter } from "@/i18n/navigation";

// The open chat's header and drawer come from the server component: refreshed here right
// away, and again by ConversationList when the members get the change (conversation:update).
const useGroupRequest = () => {
  const t = useTranslations("group");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async (request: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await request();
      router.refresh();
      return true;
    } catch (error) {
      toast.error(
        axios.isAxiosError(error) && error.response?.status === 429
          ? t("too_fast")
          : t("update_failed")
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
};

interface GroupNameProps {
  conversation: ConversationWithUsers;
}

// The group's photo (or its members' faces), with buttons to change or remove it (any member).
export const GroupPhoto: React.FC<GroupNameProps> = ({ conversation }) => {
  const t = useTranslations("group");
  const { busy, run } = useGroupRequest();
  const setImage = (image: string | null) =>
    run(() => axios.patch(`/api/conversations/${conversation.id}`, { image }));

  return (
    <div className="flex flex-col items-center gap-1">
      <AvatarGroup users={conversation.users} image={conversation.image} />
      {canEditGroup(conversation) && (
        <div className="flex items-center gap-1 text-xs">
          <ImageUploadButton onUpload={setImage} disabled={busy}>
            <span className="flex items-center gap-1 rounded-full px-2 py-1 font-medium text-sky-500 transition hover:bg-muted">
              <HiCamera size={14} aria-hidden />
              {t("change_photo")}
            </span>
          </ImageUploadButton>
          {conversation.image && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setImage(null)}
              className="rounded-full px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
              {t("remove_photo")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// this page's origin, for the full invite link (none while rendering on the server)
const noSubscription = () => () => {};
const currentOrigin = () => window.location.origin;
const noOrigin = () => "";

interface GroupInviteProps {
  conversation: ConversationWithUsers;
  myId?: string;
}

type JoinRequester = Pick<SafeUser, "id" | "name" | "email" | "image">;

// People waiting to join by the link (admins only): a face and name each, Approve / Decline.
// The list is the admins' only (omitted from conversation rows): loaded here, and again whenever
// it changes (join-requests:update, sent to the admins' tabs).
const JoinRequests: React.FC<{ conversation: ConversationWithUsers }> = ({ conversation }) => {
  const t = useTranslations("group");
  const { busy, run } = useGroupRequest();
  const [users, setUsers] = useState<JoinRequester[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      axios
        .get<JoinRequester[]>(`/api/conversations/${conversation.id}/join-requests`)
        .then(({ data }) => !cancelled && setUsers(data))
        .catch(() => undefined);
    const changed = (payload: { conversationId?: string }) => {
      if (payload?.conversationId === conversation.id) {
        void load();
      }
    };
    const socket = getSocket();
    void load();
    socket.on("join-requests:update", changed);
    // events missed while disconnected
    socket.on("connect", load);
    return () => {
      cancelled = true;
      socket.off("join-requests:update", changed);
      socket.off("connect", load);
    };
  }, [conversation.id]);

  if (users.length === 0) {
    return null;
  }
  const answer = (userId: string, approve: boolean) =>
    run(() =>
      axios.post(`/api/conversations/${conversation.id}/join-requests/${userId}`, { approve })
    );

  return (
    <div className="mt-3 border-t pt-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {t("join_requests", { count: users.length })}
      </p>
      <ul className="flex flex-col gap-2">
        {users.map((user) => (
          <li key={user.id} className="flex items-center gap-2">
            <Image
              src={user.image || "/images/placeholder.jpg"}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{user.name}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => answer(user.id, true)}
              className="shrink-0 rounded-md bg-sky-500 px-2 py-1 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
              {t("approve")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => answer(user.id, false)}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
              {t("decline")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// The invite link: every member sees and copies it while it is on; admins turn it on, reset it
// (the old link stops working) or turn it off, choose whether they approve new members, and
// answer the requests.
export const GroupInvite: React.FC<GroupInviteProps> = ({ conversation, myId }) => {
  const t = useTranslations("group");
  const locale = useLocale();
  const origin = useSyncExternalStore(noSubscription, currentOrigin, noOrigin);
  const { busy, run } = useGroupRequest();
  const isAdmin = !!myId && canManageInvite(conversation, myId);
  const code = conversation.inviteCode;

  if (!conversation.isGroup || (!code && !isAdmin)) {
    return null;
  }
  const link = code ? `${origin}/${locale}${invitePath(code)}` : "";
  const setEnabled = (enabled: boolean) =>
    run(() => axios.post(`/api/conversations/${conversation.id}/invite`, { enabled }));
  const setApproval = (approval: boolean) =>
    run(() => axios.post(`/api/conversations/${conversation.id}/invite`, { approval }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("invite_copied"));
    } catch {
      toast.error(t("invite_copy_failed"));
    }
  };

  return (
    <section className="mb-4 w-full rounded-xl border p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <HiLink size={16} aria-hidden />
        {t("invite_title")}
      </h3>
      {code ? (
        <>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link}
              aria-label={t("invite_title")}
              onFocus={(event) => event.target.select()}
              className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-1 text-xs text-foreground"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-sky-600">
              {t("invite_copy")}
            </button>
          </div>
          {isAdmin && (
            <label className="mt-2 flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={!!conversation.joinApproval}
                disabled={busy}
                onChange={(event) => setApproval(event.target.checked)}
                className="h-4 w-4 rounded border-border text-sky-500 focus:ring-sky-500"
              />
              {t("invite_approval")}
            </label>
          )}
          {isAdmin && (
            <div className="mt-2 flex justify-end gap-2 text-xs">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEnabled(true)}
                className="rounded-md px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                {t("invite_reset")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEnabled(false)}
                className="rounded-md px-2 py-1 text-rose-500 transition hover:bg-muted disabled:opacity-50">
                {t("invite_off")}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t("invite_hint")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEnabled(true)}
            className="shrink-0 rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
            {t("invite_on")}
          </button>
        </div>
      )}
      {isAdmin && <JoinRequests conversation={conversation} />}
    </section>
  );
};

// The group's name, with a pencil to rename it (any member).
export const GroupName: React.FC<GroupNameProps> = ({ conversation }) => {
  const t = useTranslations("group");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const { busy, run } = useGroupRequest();

  const save = async () => {
    const name = value.trim();
    if (!name || name === conversation.name) {
      setEditing(false);
      return;
    }
    if (await run(() => axios.patch(`/api/conversations/${conversation.id}`, { name }))) {
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="font-medium">{conversation.name}</span>
        {canEditGroup(conversation) && (
          <button
            type="button"
            onClick={() => {
              setValue(conversation.name ?? "");
              setEditing(true);
            }}
            aria-label={t("rename")}
            title={t("rename")}
            className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <HiPencil size={16} aria-hidden />
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex w-full max-w-xs items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}>
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // the drawer would close on Esc otherwise
            event.stopPropagation();
            setEditing(false);
          }
        }}
        maxLength={MAX_GROUP_NAME_LENGTH}
        disabled={busy}
        aria-label={t("name")}
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        aria-label={t("save_name")}
        title={t("save_name")}
        className="rounded-full p-1.5 text-sky-500 transition hover:bg-muted disabled:opacity-50">
        <HiCheck size={18} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        aria-label={t("cancel_rename")}
        title={t("cancel_rename")}
        className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted">
        <HiXMark size={18} aria-hidden />
      </button>
    </form>
  );
};

interface GroupMembersProps {
  conversation: ConversationWithUsers;
  // the signed-in user's id (undefined while the session loads: no actions)
  myId?: string;
  // everyone but the user: who can be added
  users: SafeUser[];
}

// The members (owner first, then admins, then the user, then by name) with their online dot, the
// owner's / admins' badge, for the owner a button making or unmaking admins, and for admins a remove
// button (two clicks: the second confirms). Any member can add people.
export const GroupMembers: React.FC<GroupMembersProps> = ({ conversation, myId, users }) => {
  const t = useTranslations("group");
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { busy, run } = useGroupRequest();

  const isAdmin = (user: SafeUser) => !!conversation.adminIds?.includes(user.id);
  const rank = (user: SafeUser) =>
    user.id === conversation.ownerId ? 0 : isAdmin(user) ? 1 : user.id === myId ? 2 : 3;
  const members = [...conversation.users].sort(
    (a, b) => rank(a) - rank(b) || (a.name ?? "").localeCompare(b.name ?? "")
  );

  const remove = (member: SafeUser) => {
    if (confirming !== member.id) {
      setConfirming(member.id);
      setTimeout(() => setConfirming((current) => (current === member.id ? null : current)), 3000);
      return;
    }
    setConfirming(null);
    run(() => axios.delete(`/api/conversations/${conversation.id}/members/${member.id}`));
  };

  return (
    <section className="w-full">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("members_title", { count: members.length })}
        </h3>
        {canEditGroup(conversation) && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-sky-500 transition hover:bg-muted">
            <HiUserPlus size={16} aria-hidden />
            {t("add_members")}
          </button>
        )}
      </div>

      {adding && (
        <AddMembers
          conversation={conversation}
          users={users}
          busy={busy}
          onAdd={async (ids) => {
            if (await run(() => axios.patch(`/api/conversations/${conversation.id}`, { addUserIds: ids }))) {
              setAdding(false);
            }
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <ul className="flex flex-col">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-3 rounded-lg px-1 py-2">
            <Avatar user={member} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm text-foreground">
                  {member.name}
                  {member.id === myId && ` (${t("you")})`}
                </span>
                {member.id === conversation.ownerId ? (
                  <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                    {t("owner")}
                  </span>
                ) : (
                  isAdmin(member) && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {t("admin")}
                    </span>
                  )
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">{member.email}</div>
            </div>
            {myId && canManageAdmins(conversation, myId, member.id) && (
              <button
                type="button"
                disabled={busy}
                aria-pressed={isAdmin(member)}
                onClick={() =>
                  run(() =>
                    axios.patch(`/api/conversations/${conversation.id}/members/${member.id}`, {
                      admin: !isAdmin(member),
                    })
                  )
                }
                aria-label={
                  isAdmin(member)
                    ? t("unmake_admin", { name: member.name ?? "" })
                    : t("make_admin", { name: member.name ?? "" })
                }
                title={
                  isAdmin(member)
                    ? t("unmake_admin", { name: member.name ?? "" })
                    : t("make_admin", { name: member.name ?? "" })
                }
                className={clsx(
                  "shrink-0 rounded-full p-1.5 transition hover:bg-muted disabled:opacity-50",
                  isAdmin(member) ? "text-sky-500" : "text-muted-foreground hover:text-foreground"
                )}>
                {isAdmin(member) ? (
                  <HiShieldCheck size={16} aria-hidden />
                ) : (
                  <HiOutlineShieldCheck size={16} aria-hidden />
                )}
              </button>
            )}
            {myId && canRemoveMember(conversation, myId, member.id) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(member)}
                aria-label={
                  confirming === member.id
                    ? t("remove_confirm", { name: member.name ?? "" })
                    : t("remove", { name: member.name ?? "" })
                }
                title={t("remove", { name: member.name ?? "" })}
                className={clsx(
                  "shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50",
                  confirming === member.id && "bg-rose-500 text-white hover:bg-rose-600 hover:text-white"
                )}>
                {confirming === member.id ? (
                  <span className="px-1 text-xs font-medium">{t("remove_short")}</span>
                ) : (
                  <HiXMark size={16} aria-hidden />
                )}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

interface AddMembersProps {
  conversation: ConversationWithUsers;
  users: SafeUser[];
  busy: boolean;
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}

// People not in the group yet, searchable by name / email, picked with checkboxes.
const AddMembers: React.FC<AddMembersProps> = ({ conversation, users, busy, onAdd, onCancel }) => {
  const t = useTranslations("group");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const candidates = users.filter((user) => !conversation.userIds.includes(user.id));
  const shown = candidates.filter((user) => matchesSearch(query, user.name, user.email));

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );

  return (
    <div className="mb-3 rounded-xl border p-3">
      {candidates.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">{t("no_one_to_add")}</p>
      ) : (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder={t("search_people")} />
          <ul className="max-h-60 overflow-y-auto">
            {shown.map((user) => (
              <li key={user.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={picked.includes(user.id)}
                    onChange={() => toggle(user.id)}
                    className="h-4 w-4 accent-sky-500"
                  />
                  <Avatar user={user} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted">
          {t("cancel_add")}
        </button>
        {candidates.length > 0 && (
          <button
            type="button"
            disabled={busy || picked.length === 0}
            onClick={() => onAdd(picked)}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
            {t("add_selected", { count: picked.length })}
          </button>
        )}
      </div>
    </div>
  );
};
