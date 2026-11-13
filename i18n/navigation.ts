import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

// Locale-aware replacements for next/link and next/navigation: they keep the
// /vi or /en prefix. usePathname() returns the path without the locale.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
