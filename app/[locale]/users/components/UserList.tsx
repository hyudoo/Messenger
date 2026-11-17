"use client";

import { SafeUser } from "@/app/types";

import { useState } from "react";
import { useTranslations } from "next-intl";

import SearchInput from "@/app/components/inputs/SearchInput";
import { matchesSearch } from "@/app/libs/search";

import UserBox from "./UserBox";

interface UserListProps {
  items: SafeUser[];
}

const UserList: React.FC<UserListProps> = ({ items }) => {
  const t = useTranslations("users");
  const [query, setQuery] = useState("");
  const visible = items.filter((item) => matchesSearch(query, item.name, item.email));

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
        {items.length > 0 && (
          <SearchInput value={query} onChange={setQuery} placeholder={t("search")} />
        )}
        {visible.map((item) => (
          <UserBox key={item.id} data={item} />
        ))}
        {query && visible.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("no_results")}</p>
        )}
      </div>
    </aside>
  );
};

export default UserList;
