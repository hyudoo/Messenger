"use client";

import useRoutes from "@/app/hooks/useRoutes";
import useConversation from "@/app/hooks/useConversation";
import MobileItem from "./MobileItem";
import LanguageToggle from "../toggles/LanguageToggle";
import ThemeToggle from "../toggles/ThemeToggle";

const MobileFooter = () => {
  const routes = useRoutes();
  const { isOpen } = useConversation();

  if (isOpen) {
    return null;
  }

  return (
    <div
      className="
            fixed
            justify-between
            w-full
            bottom-0
            z-10
            flex
            items-center
            bg-background
            border-t-[1px]
            lg:hidden
        ">
      {routes.map((route) => (
        <MobileItem
          key={route.label}
          href={route.href}
          label={route.label}
          active={route.active}
          icon={route.icon}
          onClick={route.onclick}
          badge={route.badge}
        />
      ))}
      <div className="flex shrink-0 gap-1 px-3">
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </div>
  );
};

export default MobileFooter;
