import { redirect } from "next/navigation";

import getConversationById from "@/app/actions/getConversationById";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { getIceServers } from "@/app/libs/ice-servers";
import Room from "./components/Room";

interface IParams {
  roomId: string;
}

const RoomId = async ({ params }: { params: Promise<IParams> }) => {
  const { roomId } = await params;
  const [conversation, user] = await Promise.all([
    getConversationById(roomId),
    getCurrentUser(),
  ]);

  // not a member (or no such conversation): no call room
  if (!conversation || !user) {
    redirect("/conversations");
  }

  return (
    <div className="h-full w-full">
      <Room
        roomId={roomId}
        conversation={conversation}
        user={user}
        iceServers={getIceServers(user.id)}
      />
    </div>
  );
};

export default RoomId;
