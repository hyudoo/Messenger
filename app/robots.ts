import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { PRIVATE_PATHS, siteOrigin } from "@/app/libs/site-map";

// /robots.txt: crawl the public pages, skip the API and everything behind sign-in.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const disallow = [
    "/api/",
    ...PRIVATE_PATHS,
    ...routing.locales.flatMap((locale) => PRIVATE_PATHS.map((path) => `/${locale}${path}`)),
  ];
  return {
    rules: { userAgent: "*", allow: "/", disallow },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
