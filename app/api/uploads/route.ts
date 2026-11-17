import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { createPresignedUpload, publicUrlFor } from "@/app/libs/s3";
import { UPLOAD_RULES, UploadKind } from "@/app/libs/upload";
import { logError } from "@/app/libs/log";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("upload", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    // kind: what the upload is for (older clients send none: an image); its rules decide the
    // allowed types and size, and the key's extension tells the kinds apart later
    const { contentType, size, kind = "image" } = await request.json();
    const rules = UPLOAD_RULES[kind as UploadKind];
    const extension = rules?.types[contentType];

    if (!extension) {
      return new NextResponse("Unsupported file type", { status: 400 });
    }
    if (!Number.isInteger(size) || size <= 0 || size > rules.maxSize) {
      return new NextResponse("Invalid file size", { status: 400 });
    }

    const key = `uploads/${currentUser.id}/${randomUUID()}.${extension}`;
    const { uploadUrl, headers } = await createPresignedUpload(key, contentType, size);

    return NextResponse.json({ uploadUrl, headers, fileUrl: publicUrlFor(key) });
  } catch (error) {
    logError("uploads", error);
    return new NextResponse("Error", { status: 500 });
  }
}
