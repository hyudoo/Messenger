import { NextResponse } from "next/server";
import { hasLocale } from "next-intl";

import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { routing } from "@/i18n/routing";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import {
  MAX_SUBSCRIPTIONS_PER_USER,
  getVapidPublicKey,
  isPushEndpoint,
} from "@/app/libs/web-push";

// the browser's keys, base64url
const KEY = /^[\w-]{16,256}$/;

// The VAPID public key for PushManager.subscribe; null when Web Push isn't configured.
export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}

// Stores this browser's subscription for the signed-in user (moved over if another user had it).
export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("push", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { subscription, locale } = await request.json();
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (
      !isPushEndpoint(endpoint) ||
      typeof p256dh !== "string" ||
      !KEY.test(p256dh) ||
      typeof auth !== "string" ||
      !KEY.test(auth)
    ) {
      return new NextResponse("Invalid subscription", { status: 400 });
    }
    const data = {
      p256dh,
      auth,
      locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
      userId: currentUser.id,
    };

    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, ...data },
      update: data,
    });

    // keep the user's most recently used browsers only
    const stale = await prisma.webPushSubscription.findMany({
      where: { userId: currentUser.id },
      orderBy: { updatedAt: "desc" },
      skip: MAX_SUBSCRIPTIONS_PER_USER,
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.webPushSubscription.deleteMany({
        where: { id: { in: stale.map(({ id }) => id) } },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("push.subscribe", error);
    return new NextResponse("Error", { status: 500 });
  }
}

// Forgets this browser's subscription (notifications turned off, or signing out).
export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const { endpoint } = await request.json();
    if (typeof endpoint !== "string") {
      return new NextResponse("Invalid endpoint", { status: 400 });
    }
    // only one's own: another user's browser stays subscribed
    await prisma.webPushSubscription.deleteMany({
      where: { endpoint, userId: currentUser.id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("push.unsubscribe", error);
    return new NextResponse("Error", { status: 500 });
  }
}
