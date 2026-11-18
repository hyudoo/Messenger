import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { HiChat } from "react-icons/hi";
import { HiArrowLeftOnRectangle, HiUsers } from "react-icons/hi2";
import { signOut } from "next-auth/react";

import { usePathname } from "@/i18n/navigation";
import { removePushSubscription } from "@/app/libs/push-client";
import useConversation from "./useConversation";
import useFriendRequestCount from "./useFriendRequestCount";

const useRoutes = () => {
  const t = useTranslations("nav");
  const locale = useLocale();
  // without the locale prefix
  const pathname = usePathname();
  const { conversationId } = useConversation();
  const friendRequests = useFriendRequestCount();

  const routes = useMemo(
    () => [
      {
        label: t("chat"),
        href: "/conversations",
        icon: HiChat,
        active: pathname === "/conversations" || !!conversationId,
      },
      {
        label: t("users"),
        href: "/users",
        icon: HiUsers,
        active: pathname === "/users",
        // friend requests waiting
        badge: friendRequests,
      },
      {
        label: t("logout"),
        // back to the login page in the current language; this browser stops getting the
        // user's push notifications first (it is subscribed again on the next sign-in)
        onclick: async () => {
          await removePushSubscription();
          await signOut({ callbackUrl: `/${locale}` });
        },
        href: "#",
        icon: HiArrowLeftOnRectangle,
      },
    ],
    [pathname, conversationId, t, locale, friendRequests]
  );
  return routes;
};

export default useRoutes;
