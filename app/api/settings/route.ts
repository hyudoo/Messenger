import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { isUploadedFileUrl, markUploadsUsed } from "@/app/libs/s3";
import { cleanUpUploads } from "@/app/libs/upload-cleanup";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

const MAX_NAME_LENGTH = 100;

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("settings", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { name, image } = await request.json();
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
      return new NextResponse("Invalid name", { status: 400 });
    }
    // keep the current image (e.g. an OAuth avatar) or use the user's own upload
    const keepsImage = !image || image === currentUser.image;
    if (!keepsImage && !isUploadedFileUrl(image, currentUser.id)) {
      return new NextResponse("Invalid image", { status: 400 });
    }
    if (!keepsImage) {
      // keeps the file from the pending-upload expiry; fails if it was never uploaded
      try {
        await markUploadsUsed([image]);
      } catch (error) {
        logError("mark_upload_used", error);
        return new NextResponse("Image not found", { status: 400 });
      }
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: currentUser.id,
      },
      data: {
        name: trimmedName,
        image: keepsImage ? currentUser.image : image,
      },
    });

    // the replaced avatar, if it was an upload nothing else uses
    if (!keepsImage) {
      cleanUpUploads([currentUser.image]);
    }

    return NextResponse.json(updatedUser);
  } catch (error) {
    logError("settings", error);
    return new NextResponse("Error", { status: 500 });
  }
}
