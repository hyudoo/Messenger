"use client";

import DesktopItem from "./DesktopItem";
import useRoutes from "@/app/hooks/useRoutes";
import { useState } from "react";
import { SafeUser } from "@/app/types";
import Avatar from "../Avatar";
import SettingModal from "./SettingModal";
import LanguageToggle from "../toggles/LanguageToggle";
import ThemeToggle from "../toggles/ThemeToggle";
import { useTranslations } from "next-intl";

interface DesktopSidebarProps {
  currentUser: SafeUser;
}

const DesktopSidebar: React.FC<DesktopSidebarProps> = ({ currentUser }) => {
  const t = useTranslations("nav");
  const routes = useRoutes();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <SettingModal
        currentUser={currentUser}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
      <div
        className="
            hidden
            lg:fixed
            lg:inset-y-0
            lg:left-0
            lg:z-40
            lg:w-20
            xl:px-6
            lg:overflow-y-auto
            lg:bg-background
            lg:border-r-[1px]
            lg:pb-4
            lg:flex
            lg:flex-col
            justify-between
        ">
        <nav className="mt-4 flex flex-col justify-between">
          <ul role="list" className="flex flex-col items-center space-y-1">
            {routes.map((item) => (
              <DesktopItem
                key={item.label}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={item.active}
                onClick={item.onclick}
              />
            ))}
          </ul>
        </nav>
        <nav className="mt-4 flex flex-col justify-between items-center gap-3">
          <LanguageToggle />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label={t("settings")}
            title={t("settings")}
            className="cursor-pointer hover:opacity-75 transition">
            <Avatar user={currentUser} />
          </button>
        </nav>
      </div>
    </>
  );
};

export default DesktopSidebar;
