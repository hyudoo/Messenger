import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { FullConversationType } from "../types";
import { SafeUser } from "@/app/types";

const useOtherUser = (
  conversation: FullConversationType | { users: SafeUser[] }
) => {
  const session = useSession();

  const otherUser = useMemo(() => {
    const currentUserEmail = session.data?.user?.email;

    const otherUser = conversation.users.filter(
      (user) => user.email !== currentUserEmail
    );

    return otherUser[0];
  }, [session.data?.user?.email, conversation.users]);
  return otherUser;
};

export default useOtherUser;
