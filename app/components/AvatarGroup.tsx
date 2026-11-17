"use client";

import { SafeUser } from "@/app/types";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface AvatarGroupProps {
  users?: SafeUser[];
  // the group's photo: shown instead of its members' faces
  image?: string | null;
}

const AvatarGroup: React.FC<AvatarGroupProps> = ({ users = [], image }) => {
  const t = useTranslations("common");
  if (image) {
    return (
      <div className="relative h-11 w-11 overflow-hidden rounded-full">
        <Image fill src={image} alt={t("group_photo")} className="object-cover" />
      </div>
    );
  }
  const slicedUser = users.slice(0, 3);
  const positionMap = {
    0: "top-0 left-[12px]",
    1: "bottom-0",
    2: "bottom-0 right-0",
  };
  return (
    <div className="relative h-11 w-11">
      {slicedUser.map((user, index) => (
        <div
          key={user.id}
          className={`absolute
            inline-block
            rounded-full
            overflow-hidden
            h-[21px]
            w-[21px]
            ${positionMap[index as keyof typeof positionMap]}`}>
          <Image
            fill
            src={user?.image || "/images/placeholder.jpg"}
            alt={t("avatar")}
          />
        </div>
      ))}
    </div>
  );
};

export default AvatarGroup;
