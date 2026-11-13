import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { validatePassword } from "@/app/libs/password";
import prisma from "@/app/libs/prismadb";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;

export async function POST(request: Request) {
  try {
    const { email, name, password } = await request.json();
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (typeof email !== "string" || !EMAIL.test(email) || !trimmedName) {
      return new NextResponse("Missing info", { status: 400 });
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      return new NextResponse("Name too long", { status: 400 });
    }
    // same rules as the register form; the client check alone can be skipped
    const passwordError = validatePassword(password);
    if (passwordError) {
      return new NextResponse(passwordError, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      return new NextResponse("Email already in use", { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        name: trimmedName,
        hashedPassword,
      },
      select: { id: true, email: true, name: true },
    });
    return NextResponse.json(user);
  } catch (error: any) {
    console.log(error, "REGISTRATION_ERROR");
    return new NextResponse("Internal Error", { status: 500 });
  }
}
