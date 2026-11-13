"use client";

import clsx from "clsx";
import Image from "next/image";
import { useState } from "react";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { FullMessageType } from "@/app/types";
import { useTranslations } from "next-intl";
import useDateLocale from "@/app/hooks/useDateLocale";
import { HiPhoneArrowUpRight, HiPhoneArrowDownLeft } from "react-icons/hi2";

import Avatar from "@/app/components/Avatar";
import ImageModal from "./ImageModal";

interface MessageBoxProps {
  data: FullMessageType;
  isLast?: boolean;
}

const MessageBox: React.FC<MessageBoxProps> = ({ data, isLast }) => {
  const t = useTranslations();
  const dateLocale = useDateLocale();
  const session = useSession();
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const isOwn = session.data?.user?.email === data?.sender?.email;

  const seenList = (data.seen || [])
    .filter((user) => user.email !== data?.sender?.email)
    .map((user) => user.name)
    .join(", ");

  const container = clsx("flex gap-3 p-4", isOwn && "justify-end");
  const avatar = clsx(isOwn && "order-2");
  const body = clsx("flex flex-col gap-2", isOwn && "items-end");
  const message = clsx(
    "text-sm w-fit overflow-hidden",
    isOwn ? "bg-sky-500 text-white" : "bg-muted",
    data.image ? "rounded-md p-0" : "rounded-full py-2 px-3"
  );

  return (
    <div className={container}>
      <div className={avatar}>
        <Avatar user={data.sender} />
      </div>
      <div className={body}>
        <div className="flex items-center gap-1">
          <div className="text-sm text-muted-foreground">{data.sender.name}</div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(data.createdAt), "p", { locale: dateLocale })}
          </div>
        </div>
        <div className={message}>
          {data.image && (
            <ImageModal
              src={data.image}
              isOpen={imageModalOpen}
              onClose={() => setImageModalOpen(false)}
            />
          )}
          {data.image && (
            <Image
              alt={t("common.image")}
              height="288"
              width="288"
              onClick={() => setImageModalOpen(true)}
              src={data.image}
              className="
              object-cover
              cursor-pointer
              hover:scale-110
              transition
              translate"
            />
          )}
          {data.body && <div>{data.body}</div>}
          {data.isCall && isOwn && (
            <div className="flex gap-3">
              <div className="bg-sky-600 p-1 rounded-full">
                <HiPhoneArrowUpRight size={10} className="text-white" />
              </div>
              {t("chat.outgoing_call")}
            </div>
          )}
          {data.isCall && !isOwn && (
            <div className="flex gap-3">
              <div className="bg-muted-foreground p-1 rounded-full">
                <HiPhoneArrowDownLeft size={10} className="text-white" />
              </div>
              {t("chat.incoming_call")}
            </div>
          )}
        </div>
        {isLast && isOwn && seenList.length > 0 && (
          <div
            className="
           text-xs
           font-light
           text-muted-foreground">
            {t("chat.seen_by", { names: seenList })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBox;
