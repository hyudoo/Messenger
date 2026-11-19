import Image from "next/image";
import { getTranslations } from "next-intl/server";

import LanguageToggle from "@/app/components/toggles/LanguageToggle";
import ThemeToggle from "@/app/components/toggles/ThemeToggle";
import { safeNextPath } from "@/app/libs/invite-code";
import { Link } from "@/i18n/navigation";
import AuthForm from "./components/AuthForm";

const POLICY_LINK = "whitespace-nowrap font-medium text-foreground underline underline-offset-2 hover:text-sky-600";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; deleted?: string | string[] }>;
}) {
  const tHome = await getTranslations("home");
  const tLegal = await getTranslations("legal");
  // where to go after signing in: an invite link the visitor opened signed out (proxy.ts)
  const params = await searchParams;
  const next = safeNextPath(params.next);
  // just deleted their account (DeleteAccount signs out to here)
  const deleted = params.deleted === "1";
  const tDeleted = await getTranslations("delete_account");

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-muted px-4 py-16">
      <div className="absolute right-4 top-4 flex gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* what the app is, for visitors (and Google's OAuth branding review) */}
        <header className="flex flex-col items-center text-center">
          <Image alt="" height="44" width="44" src="/images/logo.png" priority />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-foreground">Messenger</h1>
          <p className="mt-1 text-balance text-sm text-muted-foreground">{tHome("tagline")}</p>
        </header>

        {deleted && (
          <p
            role="status"
            className="mt-6 rounded-xl border border-border bg-background px-4 py-3 text-center text-sm text-foreground">
            {tDeleted("deleted")}
          </p>
        )}

        <AuthForm next={next} />

        <p className="mt-6 text-balance text-center text-xs leading-5 text-muted-foreground">
          {tLegal.rich("agree", {
            terms: (chunks) => (
              <Link href="/terms" className={POLICY_LINK}>
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href="/privacy" className={POLICY_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
