import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { blockPartnersOf } from "@/app/libs/blocks";
import { relationsWith } from "@/app/libs/friends";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { MIN_NAME_QUERY } from "@/app/libs/search";

const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 10;

// GET ?q=: finding people to add (the contacts page's "Find people"). An email (q has "@") finds
// exactly that account; else names containing q (case-insensitive, at least MIN_NAME_QUERY
// characters), at most MAX_RESULTS. Results carry no email (names and photos only, so the list
// can't be mined for addresses) and how the caller stands with each (friend / incoming /
// outgoing / none). Never the caller, nor their block partners (either way).
export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("search", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
    const byEmail = query.includes("@");
    if (query.length > MAX_QUERY_LENGTH || query.length < (byEmail ? 3 : MIN_NAME_QUERY)) {
      return new NextResponse("Invalid query", { status: 400 });
    }

    const partners = await blockPartnersOf(currentUser.id);
    const excluded = [currentUser.id, ...Array.from(partners.keys())];
    const users = await prisma.user.findMany({
      where: {
        id: { notIn: excluded },
        ...(byEmail
          ? { email: { equals: query, mode: "insensitive" } }
          : { name: { contains: query, mode: "insensitive" } }),
      },
      orderBy: { name: "asc" },
      take: MAX_RESULTS,
      select: { id: true, name: true, image: true },
    });
    const relations = await relationsWith(
      currentUser.id,
      users.map((user) => user.id)
    );
    return NextResponse.json(
      users.map((user) => ({ ...user, relation: relations.get(user.id) ?? "none" }))
    );
  } catch (error) {
    logError("user_search", error);
    return new NextResponse("Error", { status: 500 });
  }
}
