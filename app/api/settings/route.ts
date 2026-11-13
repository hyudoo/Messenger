import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { isUploadedFileUrl } from "@/app/libs/s3";
import prisma from "@/app/libs/prismadb";

const MAX_NAME_LENGTH = 100;

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { name, image } = await request.json();
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
      return new NextResponse("Invalid name", { status: 400 });
    }
    // keep the current image (e.g. an OAuth avatar) or use a file from /api/uploads
    const keepsImage = !image || image === currentUser.image;
    if (!keepsImage && !isUploadedFileUrl(image)) {
      return new NextResponse("Invalid image", { status: 400 });
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
    return NextResponse.json(updatedUser);
  } catch (error) {
    console.log(error, "ERROR_SETTINGS");
    return new NextResponse("Error", { status: 500 });
  }
}
