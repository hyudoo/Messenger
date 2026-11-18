import axios from "axios";
import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { HiUserMinus } from "react-icons/hi2";
import clsx from "clsx";
import { useRouter } from "@/i18n/navigation";
import { SafeUser } from "@/app/types";

import Avatar from "@/app/components/Avatar";
import LoadingModal from "@/app/components/modals/LoadingModal";

interface UserBoxProps {
  data: SafeUser;
}

// A friend on the contacts page: a click opens the chat with them; the person-minus button
// unfriends them after a confirming second click.
const UserBox: React.FC<UserBoxProps> = ({ data }) => {
  const t = useTranslations("common");
  const tUsers = useTranslations("users");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleClick = useCallback(() => {
    setIsLoading(true);

    axios
      .post("/api/conversations", { userId: data.id })
      .then((data) => {
        router.push(`/conversations/${data.data.id}`);
      })
      .catch(() => toast.error(t("error")))
      .finally(() => setIsLoading(false));
  }, [data, router, t]);

  const unfriend = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setIsLoading(true);
    axios
      .delete(`/api/friends/${data.id}`)
      .then(() => router.refresh())
      .catch(() => toast.error(tUsers("failed")))
      .finally(() => {
        setIsLoading(false);
        setConfirming(false);
      });
  };

  return (
    <>
      {isLoading && <LoadingModal />}
      <div className="group flex items-center gap-1 rounded-lg transition hover:bg-muted">
        <button
          type="button"
          onClick={handleClick}
          disabled={isLoading}
          className="
            min-w-0
            flex-1
            text-left
            focus:outline-none
            focus-visible:ring-2
            focus-visible:ring-sky-500
            flex
            items-center
            space-x-3
            p-3
            rounded-lg
            cursor-pointer">
          <Avatar user={data} />
          <p className="truncate text-sm font-medium text-foreground">{data.name}</p>
        </button>
        <button
          type="button"
          onClick={unfriend}
          onBlur={() => setConfirming(false)}
          disabled={isLoading}
          aria-label={confirming ? tUsers("unfriend_confirm") : tUsers("unfriend")}
          title={confirming ? tUsers("unfriend_confirm") : tUsers("unfriend")}
          className={clsx(
            "mr-2 shrink-0 rounded-full p-2 transition [@media(hover:none)]:opacity-100",
            confirming
              ? "bg-rose-500/10 text-rose-500 opacity-100"
              : "text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          )}>
          <HiUserMinus size={18} aria-hidden />
        </button>
      </div>
    </>
  );
};

export default UserBox;
