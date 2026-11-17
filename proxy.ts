// Next 16 "proxy" (formerly middleware): locale routing (next-intl) and sending
// signed-out users on protected pages to the login page, in their language.
import createMiddleware from "next-intl/middleware";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

import { routing } from "./i18n/routing";
import { safeNextPath } from "./app/libs/invite-code";

const intlMiddleware = createMiddleware(routing);

const PROTECTED_PATHS = ["/conversations", "/users", "/room", "/join"];
const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

const localeOf = (req: NextRequest) => {
  const fromPath = LOCALE_PREFIX.exec(req.nextUrl.pathname)?.[1];
  const fromCookie = req.cookies.get("NEXT_LOCALE")?.value;
  const candidate = fromPath ?? fromCookie;
  return routing.locales.find((locale) => locale === candidate) ?? routing.defaultLocale;
};

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(LOCALE_PREFIX, "") || "/";
  const isProtected = PROTECTED_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );

  if (isProtected) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = `/${localeOf(req)}`;
      url.search = "";
      // an invite link opens again after signing in (AuthForm); nothing else is passed on
      const next = safeNextPath(path);
      if (next) {
        url.searchParams.set("next", next);
      }
      return NextResponse.redirect(url);
    }
  }

  return intlMiddleware(req);
}

export const config = {
  // pages only: not API routes, socket.io, Next internals or files with an extension
  matcher: ["/((?!api|socket\\.io|_next|_vercel|.*\\..*).*)"],
};
