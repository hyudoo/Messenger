import getConversationById from "@/app/actions/getConversationById";

import Room from "./components/Room";
import getCurrentUser from "@/app/actions/getCurrentUser";
interface IParams {
  roomId: string;
}

const RoomId = async ({ params }: { params: Promise<IParams> }) => {
  const { roomId } = await params;
  const conversation = await getConversationById(roomId);
  const user = await getCurrentUser();

  return (
    <div className="h-full w-full">
      <Room roomId={roomId} conversation={conversation!} user={user!} />
    </div>
  );
};

export default RoomId;
