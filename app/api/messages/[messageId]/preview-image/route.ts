import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { fetchPreviewImage } from "@/app/libs/link-preview";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  messageId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// GET: the image of a message's link preview, fetched by the server, so the linked site never
// learns the reader's IP (and the CSP needs no `img-src https:`). The URL comes from the stored
// preview, never from the request, so this can't be used to fetch anything else; the fetch has
// the same SSRF checks as the page (app/libs/link-preview.ts). Members of the conversation only.
export async function GET(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("previewImage", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { messageId } = await params;
    const message =
      messageId && OBJECT_ID.test(messageId)
        ? await prisma.message.findUnique({
            where: { id: messageId },
            select: { conversationId: true, linkPreview: true, deletedAt: true },
          })
        : null;
    const conversation =
      message && (await getConversationForUser(message.conversationId, currentUser.id));
    const url = message?.linkPreview?.image;
    if (!message || !conversation || !url || message.deletedAt) {
      return new NextResponse("Not found", { status: 404 });
    }

    const image = await fetchPreviewImage(url).catch(() => null);
    if (!image) {
      return new NextResponse("Not found", { status: 404 });
    }
    return new Response(new Uint8Array(image.body), {
      headers: {
        "Content-Type": image.type,
        "Content-Length": String(image.body.length),
        // the stored URL doesn't change: the browser keeps it for a day
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    logError("preview_image", error);
    return new NextResponse("Error", { status: 500 });
  }
}
