import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { PUBLIC_PATHS, localizedUrl, siteOrigin } from "@/app/libs/site-map";

// /sitemap.xml: the public pages in every language, each listing its translations (hreflang).
// Built per request so NEXTAUTH_URL comes from the running server's .env, not the build.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return PUBLIC_PATHS.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: localizedUrl(origin, locale, path),
      changeFrequency: path === "" ? ("weekly" as const) : ("yearly" as const),
      priority: path === "" ? 1 : 0.3,
      alternates: {
        languages: {
          ...Object.fromEntries(
            routing.locales.map((other) => [other, localizedUrl(origin, other, path)])
          ),
          "x-default": localizedUrl(origin, routing.defaultLocale, path),
        },
      },
    }))
  );
}
