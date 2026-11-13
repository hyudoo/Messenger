import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { createPresignedUpload, publicUrlFor } from "@/app/libs/s3";
import { IMAGE_TYPES, MAX_IMAGE_SIZE } from "@/app/libs/upload";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = rateLimit("upload", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { contentType, size } = await request.json();
    const extension = IMAGE_TYPES[contentType];

    if (!extension) {
      return new NextResponse("Unsupported file type", { status: 400 });
    }
    if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_SIZE) {
      return new NextResponse("Invalid file size", { status: 400 });
    }

    const key = `uploads/${currentUser.id}/${randomUUID()}.${extension}`;
    const uploadUrl = await createPresignedUpload(key, contentType, size);

    return NextResponse.json({ uploadUrl, fileUrl: publicUrlFor(key) });
  } catch (error) {
    console.log(error, "ERROR_UPLOADS");
    return new NextResponse("Error", { status: 500 });
  }
}
