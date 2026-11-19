"use client";

import { createContext, useContext } from "react";

import { Nickname, displayName } from "@/app/libs/nicknames";
import { SafeUser } from "@/app/types";

// The roles that decide who may do what in a group (isGroupAdmin, app/libs/conversation-permissions.ts)
export type ChatRoles = { isGroup: boolean; ownerId?: string | null; adminIds?: string[] | null };

// The open chat's members, nicknames and roles (Body provides them), so rows can name people as
// this conversation calls them (MessageBox's sender, PollCard's voters) and know what the user may
// do (PollCard's Close for group admins) without more props on the memoized MessageBox.
const ChatPeopleContext = createContext<{
  members: SafeUser[];
  nicknames: Nickname[];
  roles: ChatRoles;
}>({
  members: [],
  nicknames: [],
  roles: { isGroup: false },
});
export const ChatPeopleProvider = ChatPeopleContext.Provider;

export const useChatPeople = () => {
  const { members, nicknames, roles } = useContext(ChatPeopleContext);
  return {
    members,
    roles,
    // a person's nickname here, else their name (also for people no longer in the chat)
    nameOf: (user: { id: string; name: string | null } | null | undefined) => displayName(user, nicknames),
    nameOfId: (id: string) => displayName(members.find((member) => member.id === id), nicknames),
  };
};
