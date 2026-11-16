import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

import getCallType from "@/app/actions/getCallType";
import getConversationById from "@/app/actions/getConversationById";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { getIceServers } from "@/app/libs/ice-servers";
import Room from "./components/Room";

interface IParams {
  roomId: string;
}

const RoomId = async ({ params }: { params: Promise<IParams> }) => {
  const { roomId } = await params;
  const [conversation, user, callType] = await Promise.all([
    getConversationById(roomId),
    getCurrentUser(),
    getCallType(roomId),
  ]);

  // not a member (or no such conversation): no call room
  if (!conversation || !user) {
    // the request locale, already validated by the [locale] layout
    return redirect({ href: "/conversations", locale: await getLocale() });
  }

  return (
    <div className="h-full w-full">
      <Room
        roomId={roomId}
        conversation={conversation}
        user={user}
        audioOnly={callType === "audio"}
        iceServers={getIceServers(user.id)}
      />
    </div>
  );
};

export default RoomId;
