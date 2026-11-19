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
  searchParams: Promise<{ next?: string | string[]; deleted?: string | string[] }>;
}) {
  const t = await getTranslations("auth");
  const tHome = await getTranslations("home");
  const tLegal = await getTranslations("legal");
  // where to go after signing in: an invite link the visitor opened signed out (proxy.ts)
  const params = await searchParams;
  const next = safeNextPath(params.next);
  // just deleted their account (DeleteAccount signs out to here)
  const deleted = params.deleted === "1";
  const tDeleted = await getTranslations("delete_account");

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
        {/* what the app is, for visitors (and Google's OAuth branding review: the home page must
            say what the app does and how it uses Google data) */}
        <section className="mt-4 px-4 text-center" aria-labelledby="home-title">
          <h1 id="home-title" className="text-2xl font-bold tracking-tight text-foreground">
            Messenger
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{tHome("tagline")}</p>
        </section>
        <h2 className="mt-8 text-center text-3xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h2>
      </div>

      {deleted && (
        <p
          role="status"
          className="mx-4 mt-6 rounded-lg bg-background px-4 py-3 text-center text-sm text-foreground sm:mx-auto sm:w-full sm:max-w-md">
          {tDeleted("deleted")}
        </p>
      )}

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
