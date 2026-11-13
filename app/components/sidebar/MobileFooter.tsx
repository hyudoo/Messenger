"use client";

import useRoutes from "@/app/hooks/useRoutes";
import useConversation from "@/app/hooks/useConversation";
import MobileItem from "./MobileItem";
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
            justify-betwwen
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
          key={route.href}
          href={route.href}
          active={route.active}
          icon={route.icon}
          onClick={route.onclick}
        />
      ))}
      <div className="flex shrink-0 px-3">
        <ThemeToggle />
      </div>
    </div>
  );
};

export default MobileFooter;
