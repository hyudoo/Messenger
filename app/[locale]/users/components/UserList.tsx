"use client";

import { SafeUser } from "@/app/types";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import SearchInput from "@/app/components/inputs/SearchInput";
import type { FriendRequestItem } from "@/app/actions/getFriendRequests";
import { getSocket } from "@/app/libs/socket-client";
import { matchesSearch } from "@/app/libs/search";
import { useRouter } from "@/i18n/navigation";

import FriendRequests from "./FriendRequests";
import PeopleSearch from "./PeopleSearch";
import UserBox from "./UserBox";

interface UserListProps {
  // the user's friends (getUsers)
  items: SafeUser[];
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
}

// The contacts page: friend requests, then the friends (filtered by the search box), then, for a
// long enough query, "Find people" (anyone by exact email or by name). Reloaded when friends or
// requests change on either side (contacts:update with `friends`).
const UserList: React.FC<UserListProps> = ({ items, incoming, outgoing }) => {
  const t = useTranslations("users");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const visible = items.filter((item) => matchesSearch(trimmed, item.name, item.email));

  useEffect(() => {
    const socket = getSocket();
    const changed = (payload: { friends?: boolean }) => {
      if (payload?.friends) {
        router.refresh();
      }
    };
    socket.on("contacts:update", changed);
    return () => {
      socket.off("contacts:update", changed);
    };
  }, [router]);

  return (
    <aside
      className="
        fixed
        inset-y-0
        pb-20
        lg:pb-0
        lg:left-20
        lg:w-80
        lg:block
        overflow-y-auto
        border-r
        border-border
        block
        w-full
        left-0">
      <div className="px-5">
        <div className="flex-col">
          <div
            className="
                    text-2xl
                    font-bold
                    text-foreground
                    py-4">
            {t("title")}
          </div>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder={t("search")} />
        {!trimmed && <FriendRequests incoming={incoming} outgoing={outgoing} />}
        {(visible.length > 0 || !trimmed) && (
          <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("friends_heading", { count: items.length })}
          </h3>
        )}
        {visible.map((item) => (
          <UserBox key={item.id} data={item} />
        ))}
        {!trimmed && items.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t("no_friends")}</p>
        )}
        <PeopleSearch query={trimmed} />
      </div>
    </aside>
  );
};

export default UserList;
