import Image from "next/image";
import { useTranslations } from "next-intl";

import LanguageToggle from "@/app/components/toggles/LanguageToggle";
import ThemeToggle from "@/app/components/toggles/ThemeToggle";
import AuthForm from "./components/AuthForm";

export default function Home() {
  const t = useTranslations("auth");

  return (
    <div
      className="
        relative
        flex
        min-h-full
        flex-col
        justify-center
        py-12
        sm:px-6
        lg:px-8
        bg-muted
    ">
      <div className="absolute right-4 top-4 flex gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="sm:mx-auto sm:v-full sm:max-w-md">
        <Image
          alt="Logo"
          height="48"
          width="48"
          className="mx-auto w-auto"
          src="/images/logo.png"
        />
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h2>
      </div>

      <AuthForm />
    </div>
  );
}
