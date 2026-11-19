import Image from "next/image";
import clsx from "clsx";
import { HiArrowLeft } from "react-icons/hi2";

import LanguageToggle from "@/app/components/toggles/LanguageToggle";
import ThemeToggle from "@/app/components/toggles/ThemeToggle";
import { Link } from "@/i18n/navigation";

// The frame of the public account pages reached from a mail or the login form ("forgot
// password", "reset password", "verify email"): the same brand header, toggles and card as the
// login page, and a way back under the card.
const AccountShell: React.FC<{
  children: React.ReactNode;
  back: { href: string; label: string };
}> = ({ children, back }) => (
  <div className="relative flex min-h-full flex-col items-center justify-center bg-muted px-4 py-16">
    <div className="absolute right-4 top-4 flex gap-2">
      <LanguageToggle />
      <ThemeToggle />
    </div>
    <div className="w-full max-w-sm">
      <Link href="/" className="mx-auto flex w-fit items-center gap-2 rounded-md">
        <Image alt="" height="32" width="32" src="/images/logo.png" priority />
        <span className="text-lg font-semibold tracking-tight text-foreground">Messenger</span>
      </Link>
      <div className="mt-6 rounded-2xl border border-border bg-background p-6 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.12)] sm:p-8">
        {children}
      </div>
      <Link
        href={back.href}
        className="mx-auto mt-6 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <HiArrowLeft aria-hidden className="h-4 w-4" />
        {back.label}
      </Link>
    </div>
  </div>
);

// The top of such a card: an icon in a tinted circle, the title and a line of explanation.
export const AccountCardHeading: React.FC<{
  icon: React.ReactNode;
  title: string;
  intro?: React.ReactNode;
  tone?: "brand" | "success" | "danger";
}> = ({ icon, title, intro, tone = "brand" }) => (
  <div className="mb-6">
    <div
      aria-hidden
      className={clsx(
        "mb-4 flex h-11 w-11 items-center justify-center rounded-full [&>svg]:h-6 [&>svg]:w-6",
        tone === "brand" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        tone === "success" && "bg-green-500/10 text-green-600 dark:text-green-400",
        tone === "danger" && "bg-rose-500/10 text-rose-600 dark:text-rose-400"
      )}>
      {icon}
    </div>
    <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
    {intro && <p className="mt-2 text-sm leading-6 text-muted-foreground">{intro}</p>}
  </div>
);

export default AccountShell;
