import { cache } from "react";

import prisma from "@/app/libs/prismadb";
import getSession from "./getSession";

// cache(): one session decode + one user query per server request
const getCurrentUser = cache(async () => {
  try {
    const session = await getSession();

    if (!session?.user?.email) {
      return null;
    }

    return await prisma.user.findUnique({
      where: {
        email: session.user.email as string,
      },
    });
  } catch (error: any) {
    return null;
  }
});

export default getCurrentUser;
