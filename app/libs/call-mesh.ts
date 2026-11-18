// Group calls are a mesh: every two peers in a call room have their own RTCPeerConnection, so each
// peer sends its camera and mic once per other peer. That stays usable up to about four people,
// hence the cap (1:1 chats: two). Shared by the socket server (admission) and Room.tsx.
export const MAX_CALL_PEERS = 2;
export const MAX_GROUP_CALL_PEERS = 4;

export const maxCallPeers = (isGroup: boolean) =>
  isGroup ? MAX_GROUP_CALL_PEERS : MAX_CALL_PEERS;

// A peer in a call room: its socket id (the address of the signalling) and its user.
export interface CallPeer {
  id: string;
  userId: string;
}

// What the socket server relays for call:ready / call:offer / call:answer / call:ice-candidate /
// call:media: the sender's socket and user (set by the server, so they can be trusted), the room
// (a socket is in one call at a time, but a stale signal of another room must be ignored) and the
// payload as the sender gave it (unchecked: validate it).
export interface CallSignal {
  roomId: string;
  from: string;
  userId: string;
  data?: unknown;
}

export const isCallSignal = (value: unknown): value is CallSignal =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CallSignal).roomId === "string" &&
  typeof (value as CallSignal).from === "string" &&
  typeof (value as CallSignal).userId === "string";

// Of two peers, the one whose socket id sorts first sends the offer, the other one answers. Both
// sides compute the same answer from the ids alone: no host, no clocks.
export const isOfferer = (ownId: string, peerId: string) => ownId < peerId;
