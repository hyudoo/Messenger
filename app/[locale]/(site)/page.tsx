import Image from "next/image";
import { getTranslations } from "next-intl/server";

import LanguageToggle from "@/app/components/toggles/LanguageToggle";
import ThemeToggle from "@/app/components/toggles/ThemeToggle";
import { safeNextPath } from "@/app/libs/invite-code";
import { Link } from "@/i18n/navigation";
import AuthForm from "./components/AuthForm";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const t = await getTranslations("auth");
  const tLegal = await getTranslations("legal");
  // where to go after signing in: an invite link the visitor opened signed out (proxy.ts)
  const next = safeNextPath((await searchParams).next);

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

      <AuthForm next={next} />

      <p className="mt-6 px-4 text-center text-xs text-muted-foreground">
        {tLegal("agree")}
        <span className="mt-1 flex justify-center gap-3">
          <Link href="/terms" className="underline hover:text-foreground">
            {tLegal("terms_link")}
          </Link>
          <Link href="/privacy" className="underline hover:text-foreground">
            {tLegal("privacy_link")}
          </Link>
        </span>
      </p>
    </div>
  );
}
