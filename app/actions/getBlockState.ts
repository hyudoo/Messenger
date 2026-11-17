import getCurrentUser from "./getCurrentUser";
import { blockStateWith } from "@/app/libs/blocks";

// For a 1:1 chat with `otherId`: whether the signed-in user blocked them and / or was blocked.
const getBlockState = async (otherId: string | undefined) => {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id || !otherId) {
    return { byMe: false, byThem: false };
  }
  try {
    return await blockStateWith(currentUser.id, otherId);
  } catch {
    return { byMe: false, byThem: false };
  }
};

export default getBlockState;
