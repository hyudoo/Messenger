import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { logError } from "@/app/libs/log";

interface IParams {
  messageId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// Content-Disposition with the original name: an ASCII fallback plus the UTF-8 name (RFC 6266)
const contentDisposition = (name: string) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

// GET: a file message's file, saved under the name it was sent with (S3 serves it under its
// uuid key). Streamed from the bucket's public URL, which comes from the stored message (never
// from the request), so this can't fetch anything else. Members of the conversation only.
export async function GET(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const { messageId } = await params;
    const message =
      messageId && OBJECT_ID.test(messageId)
        ? await prisma.message.findUnique({
            where: { id: messageId },
            select: { conversationId: true, attachment: true, deletedAt: true },
          })
        : null;
    const conversation =
      message && (await getConversationForUser(message.conversationId, currentUser.id));
    if (!message || !conversation || !message.attachment || message.deletedAt) {
      return new NextResponse("Not found", { status: 404 });
    }

    const upstream = await fetch(message.attachment.url);
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Not found", { status: 404 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": message.attachment.type,
        ...(upstream.headers.get("content-length") && {
          "Content-Length": upstream.headers.get("content-length")!,
        }),
        "Content-Disposition": contentDisposition(message.attachment.name),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logError("message_download", error);
    return new NextResponse("Error", { status: 500 });
  }
}
