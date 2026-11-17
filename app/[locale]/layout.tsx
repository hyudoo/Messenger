import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import ActiveStatus from "@/app/components/ActiveStatus";
import IncomingCall from "@/app/components/IncomingCall";
import MessageNotifications from "@/app/components/MessageNotifications";
import {
  THEME_INIT_SCRIPT,
  ThemeProvider,
} from "@/app/components/providers/ThemeProvider";
import AuthContext from "@/app/context/AuthContext";
import ToasterContext from "@/app/context/ToasterContext";

import "../globals.css";

const inter = Inter({ subsets: ["latin"] });

interface LocaleParams {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: LocaleParams) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "meta",
  });
  return { title: "Messenger", description: t("description") };
}

// The root layout: every page lives under /[locale].
export default async function LocaleLayout({
  children,
  params,
}: LocaleParams & { children: React.ReactNode }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const messages = await getMessages();

  return (
    // the init script sets the `dark` class before React hydrates
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <ThemeProvider disableTransitionOnChange>
          <NextIntlClientProvider messages={messages}>
            <AuthContext>
              <ActiveStatus />
              <IncomingCall />
              <MessageNotifications />
              <ToasterContext />
              {children}
            </AuthContext>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
