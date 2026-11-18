import type { MetadataRoute } from "next";

import vi from "@/i18n/messages/vi.json";
import { routing } from "@/i18n/routing";

// The web app manifest (/manifest.webmanifest): the app can be installed to the home screen /
// desktop and opens in its own window. On iOS, Web Push only works for an app installed this way.
// One manifest for both languages (in the default one); "/" goes to the user's locale (proxy.ts,
// NEXT_LOCALE cookie). Icons: scripts/generate-pwa-icons.ts.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Messenger",
    short_name: "Messenger",
    description: vi.meta.description,
    lang: routing.defaultLocale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0ea5e9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
