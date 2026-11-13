"use client";

import { SafeUser } from "@/app/types";

import { useTranslations } from "next-intl";

import UserBox from "./UserBox";

interface UserListProps {
  items: SafeUser[];
}

const UserList: React.FC<UserListProps> = ({ items }) => {
  const t = useTranslations("users");

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
        {items.map((item) => (
          <UserBox key={item.id} data={item} />
        ))}
      </div>
    </aside>
  );
};

export default UserList;
