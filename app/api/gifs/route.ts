import { NextResponse } from "next/server";
import { hasLocale } from "next-intl";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { giphyEnabled, isGifKind, searchGiphy } from "@/app/libs/giphy";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { routing } from "@/i18n/routing";

const MAX_QUERY_LENGTH = 50;
// GIPHY serves results up to this offset
const MAX_OFFSET = 4999;

// GET ?q=&kind=gif|sticker&offset=&lang=: one page of GIPHY GIFs or stickers for the composer's picker,
// trending without q. 503 when GIPHY isn't configured, 502 when it fails.
export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    if (!giphyEnabled()) {
      return new NextResponse("GIFs are not available", { status: 503 });
    }
    const limited = await rateLimit("gif", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
    const kind = searchParams.get("kind") ?? "gif";
    const offset = Number(searchParams.get("offset") ?? 0);
    if (
      query.length > MAX_QUERY_LENGTH ||
      !isGifKind(kind) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > MAX_OFFSET
    ) {
      return new NextResponse("Invalid query", { status: 400 });
    }

    // the query's language (the app's locale)
    const lang = searchParams.get("lang");
    const locale = hasLocale(routing.locales, lang) ? lang : routing.defaultLocale;
    try {
      return NextResponse.json(await searchGiphy({ query, kind, offset, locale }));
    } catch (error) {
      logError("giphy_search", error);
      return new NextResponse("GIPHY failed", { status: 502 });
    }
  } catch (error) {
    logError("gifs", error);
    return new NextResponse("Error", { status: 500 });
  }
}
