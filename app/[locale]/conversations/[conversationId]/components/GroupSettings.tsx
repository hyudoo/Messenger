"use client";

import axios from "axios";
import clsx from "clsx";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { HiCheck, HiPencil, HiUserPlus, HiXMark } from "react-icons/hi2";

import Avatar from "@/app/components/Avatar";
import SearchInput from "@/app/components/inputs/SearchInput";
import {
  MAX_GROUP_NAME_LENGTH,
  canEditGroup,
  canRemoveMember,
} from "@/app/libs/conversation-permissions";
import { matchesSearch } from "@/app/libs/search";
import { ConversationWithUsers, SafeUser } from "@/app/types";
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

// The members (owner first, then the user, then by name) with their online dot, the owner's
// badge and, for the owner, a remove button (two clicks: the second confirms). Below, any member
// can add people.
export const GroupMembers: React.FC<GroupMembersProps> = ({ conversation, myId, users }) => {
  const t = useTranslations("group");
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { busy, run } = useGroupRequest();

  const rank = (user: SafeUser) =>
    user.id === conversation.ownerId ? 0 : user.id === myId ? 1 : 2;
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
                {member.id === conversation.ownerId && (
                  <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                    {t("owner")}
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">{member.email}</div>
            </div>
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
