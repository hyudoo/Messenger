import axios from "axios";
import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SafeUser } from "@/app/types";

import Avatar from "@/app/components/Avatar";
import LoadingModal from "@/app/components/modals/LoadingModal";

interface UserBoxProps {
  data: SafeUser;
}

const UserBox: React.FC<UserBoxProps> = ({ data }) => {
  const t = useTranslations("common");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <>
      {isLoading && <LoadingModal />}
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="w-full
            text-left
            focus:outline-none
            focus-visible:ring-2
            focus-visible:ring-sky-500
            relative
            flex
            items-center
            space-x-3
            bg-background
            p-3
            hover:bg-muted
            rounded-lg
            transition
            cursor-pointer">
        <Avatar user={data} />
        <div className="min-w-0 flex-1">
          <div className="focus:outline-none">
            <span className="absolute inset-0" aria-hidden="true" />
            <div className="flex justify-between items-center mb-1">
              <p className="text-sm font-medium text-foreground">{data.name}</p>
            </div>
          </div>
        </div>
      </button>
    </>
  );
};

export default UserBox;
