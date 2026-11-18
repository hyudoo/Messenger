import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import LanguageToggle from "@/app/components/toggles/LanguageToggle";
import ThemeToggle from "@/app/components/toggles/ThemeToggle";

type Section = { title: string; paragraphs: string[] };

// The privacy policy and terms of service pages: public (not in proxy.ts's PROTECTED_PATHS),
// text from the "legal.<doc>" messages. Each doc links to the other one at the bottom.
export default async function LegalPage({ doc }: { doc: "privacy" | "terms" }) {
  const t = await getTranslations("legal");
  const sections = t.raw(`${doc}.sections`) as Section[];
  const other = doc === "privacy" ? "terms" : "privacy";

  return (
    <div className="min-h-full bg-muted">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium text-foreground transition hover:text-sky-500">
            <Image src="/images/logo.png" alt="" width={28} height={28} />
            <span>{t("back")}</span>
          </Link>
          <div className="flex gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <article className="rounded-lg bg-background px-5 py-8 shadow-sm sm:px-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t(`${doc}.title`)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("updated")}</p>
          <p className="mt-6 leading-7 text-foreground">{t(`${doc}.intro`)}</p>

          {sections.map((section) => (
            <section key={section.title} className="mt-8">
              <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
              {section.paragraphs.map((paragraph, i) => (
                <p key={i} className="mt-3 leading-7 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          <div className="mt-10 border-t border-border pt-6 text-sm">
            <Link href={`/${other}`} className="font-medium text-sky-500 hover:underline">
              {t(`${other}_link`)}
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
