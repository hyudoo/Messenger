"use client";

import { Conversation } from "@prisma/client";
import { SafeUser } from "@/app/types";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { FaMicrophoneSlash } from "react-icons/fa";
import { HiPhone, HiComputerDesktop } from "react-icons/hi2";
import Footer from "./Footer";
import { toast } from "react-hot-toast";

import { getSocket } from "@/app/libs/socket-client";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import Header from "./Header";
import clsx from "clsx";
import useOtherUser from "@/app/hooks/useOtherUser";
import useCallTone from "@/app/hooks/useCallTone";
import { CALL_RING_TIMEOUT_MS } from "@/app/libs/call";
import {
  isCallSignal,
  isOfferer,
  type CallPeer,
  type CallSignal,
} from "@/app/libs/call-mesh";

interface BodyProps {
  roomId: String;
  user: SafeUser;
  conversation: Conversation & {
    users: SafeUser[];
  };
  // STUN, plus TURN with short-lived credentials when configured (app/libs/ice-servers.ts)
  iceServers: RTCIceServer[];
  // an audio call: no camera at all (getCallType, from the call message)
  audioOnly?: boolean;
}

type CallStatus =
  | "connecting"
  | "waiting"
  | "connected"
  | "reconnecting"
  | "failed";

type PeerState = "connecting" | "connected" | "reconnecting" | "failed";

interface MediaState {
  mic: boolean;
  camera: boolean;
  // sharing the screen (sent instead of the camera); missing from older clients
  screen?: boolean;
}

// Another peer of the call (a mesh: one RTCPeerConnection each, app/libs/call-mesh.ts)
interface RemotePeer {
  // its socket id: the address of its signalling
  id: string;
  userId: string;
  state: PeerState;
  media: MediaState;
  // its tracks, collected from ontrack (a video transceiver added without a track, as in an
  // audio call, arrives with no stream of its own); the same object for the peer's whole stay
  stream: MediaStream;
}

interface JoinResult {
  ok: boolean;
  peers?: CallPeer[];
  reason?: "full";
}

const isMediaState = (value: unknown): value is MediaState =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as MediaState).mic === "boolean" &&
  typeof (value as MediaState).camera === "boolean" &&
  ["boolean", "undefined"].includes(typeof (value as MediaState).screen);

const isDescription = (value: unknown, type: "offer" | "answer"): value is RTCSessionDescriptionInit =>
  typeof value === "object" &&
  value !== null &&
  (value as RTCSessionDescriptionInit).type === type &&
  typeof (value as RTCSessionDescriptionInit).sdp === "string";

// screen sharing needs getDisplayMedia (desktop browsers; not phones)
const noSubscription = () => () => {};
const canShareScreen = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getDisplayMedia === "function";

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
};

// Call duration, ticking every second from `since` (ms timestamp)
const CallTimer: React.FC<{ since: number }> = ({ since }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - since) / 1000));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);
  return <>{formatDuration(elapsed)}</>;
};

// Large round avatar for the call screen (the shared Avatar is sidebar-sized)
const CallAvatar: React.FC<{
  image?: string | null;
  alt: string;
  pulse?: boolean;
  className?: string;
}> = ({ image, alt, pulse, className }) => (
  <div className={clsx("relative", className)}>
    {pulse && (
      <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />
    )}
    <div className="relative h-full w-full overflow-hidden rounded-full ring-4 ring-white/10">
      <Image
        fill
        sizes="128px"
        className="object-cover"
        src={image || "/images/placeholder.jpg"}
        alt={alt}
      />
    </div>
  </div>
);

// One other peer: its video (which also plays its audio, so it stays mounted), covered by its
// avatar until media flows or while its camera is off. `large`: the only other peer, full screen
// (a 1:1 call), with the call status under the name; otherwise a tile of the group grid.
const PeerTile: React.FC<{
  peer: RemotePeer;
  user?: SafeUser;
  name: string;
  audioOnly: boolean;
  large: boolean;
  status: React.ReactNode;
}> = ({ peer, user, name, audioOnly, large, status }) => {
  const t = useTranslations("call");
  const tCommon = useTranslations("common");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) {
      video.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  const connected = peer.state === "connected";
  const showCover = !connected || (!peer.media.camera && !peer.media.screen);
  const peerStatus =
    peer.state === "reconnecting"
      ? t("status_reconnecting")
      : peer.state === "failed"
        ? t("status_failed")
        : t("status_connecting");

  return (
    <div
      className={clsx(
        "relative overflow-hidden bg-neutral-900",
        large ? "absolute inset-0" : "min-h-0 rounded-2xl ring-1 ring-white/10"
      )}>
      <video
        className={clsx("absolute inset-0 h-full w-full", large || peer.media.screen ? "object-contain" : "object-cover")}
        autoPlay
        playsInline
        ref={video}
      />
      {showCover && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 px-4 text-center sm:gap-5">
          <CallAvatar
            image={user?.image}
            alt={tCommon("avatar")}
            pulse={!connected}
            className={clsx(
              large
                ? audioOnly
                  ? "h-32 w-32 sm:h-40 sm:w-40"
                  : "h-28 w-28 sm:h-32 sm:w-32"
                : "h-16 w-16 sm:h-20 sm:w-20"
            )}
          />
          {large && (
            <div className="space-y-1">
              <div className="text-xl font-semibold">{name}</div>
              <div className="text-sm tabular-nums text-white/60">
                {connected && !audioOnly ? t("camera_is_off", { name }) : status}
              </div>
              {audioOnly && (
                <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-white/40">
                  <HiPhone size={12} aria-hidden />
                  {t("audio_call")}
                </div>
              )}
            </div>
          )}
          {!large && !connected && (
            <div className="text-xs text-white/60">{peerStatus}</div>
          )}
        </div>
      )}
      {!large && (
        <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium backdrop-blur">
          {connected && !peer.media.mic && (
            <FaMicrophoneSlash size={11} className="shrink-0 text-red-400" aria-label={t("muted")} />
          )}
          {peer.media.screen && <HiComputerDesktop size={12} className="shrink-0" aria-hidden />}
          <span className="truncate">{name}</span>
        </div>
      )}
    </div>
  );
};

interface CallHandlers {
  handleJoined: (res: JoinResult) => void;
  handleReconnected: () => void;
  handleReady: (signal: CallSignal) => void;
  handleOffer: (signal: CallSignal) => void;
  handleAnswer: (signal: CallSignal) => void;
  handleIceCandidate: (signal: CallSignal) => void;
  handleMedia: (signal: CallSignal) => void;
  handlePeerLeft: (peerId: string) => void;
  handleDeclined: () => void;
  handleNoAnswer: () => void;
}

const Body: React.FC<BodyProps> = ({
  roomId,
  user,
  conversation,
  iceServers,
  audioOnly = false,
}) => {
  const [micActive, setMicActive] = useState(true);
  const [cameraActive, setCameraActive] = useState(!audioOnly);
  const [sharing, setSharing] = useState(false);
  const shareSupported = useSyncExternalStore(noSubscription, canShareScreen, () => false);
  // the shared screen's track while sharing (sent instead of the camera)
  const screenTrack = useRef<MediaStreamTrack | null>(null);
  // our camera / mic are up (then we announce call:ready)
  const [mediaReady, setMediaReady] = useState(false);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const otherUser = useOtherUser(conversation);
  const isGroup = !!conversation.isGroup;
  const callName = conversation.name || otherUser?.name || "";

  const t = useTranslations("call");
  const tCommon = useTranslations("common");
  const tSystem = useTranslations("system");
  const router = useRouter();

  const usersById = new Map(conversation.users.map((member) => [member.id, member]));
  usersById.set(user.id, user);
  const userOf = (userId: string) => usersById.get(userId);
  const nameOf = (userId: string) => userOf(userId)?.name || tSystem("someone");

  // our mic / camera state, for handlers created outside render (peer connections)
  const localMedia = useRef<MediaState>({ mic: true, camera: !audioOnly });

  const userStream = useRef<MediaStream | undefined>(undefined);
  const userVideo = useRef<HTMLVideoElement>(null);
  const mediaRequested = useRef(false);
  const ready = useRef(false);

  // the other peers by socket id: their user, their stream and our connection to them. The
  // source of truth for the handlers; `peers` mirrors it for rendering
  const peerUsers = useRef(new Map<string, string>());
  const remoteStreams = useRef(new Map<string, MediaStream>());
  const connections = useRef(new Map<string, RTCPeerConnection>());
  // somebody else was in the call: once they are all gone, we leave too
  const hadPeer = useRef(false);
  // our socket id when we joined: a reconnect changes it (and the server dropped us from the room)
  const joinedAs = useRef<string | undefined>(undefined);
  const left = useRef(false);

  // Sends a signalling message through the socket server: to one peer (`to`) or the whole room
  const signal = (event: string, message: { to?: string; data?: unknown } = {}) => {
    getSocket().emit(event, String(roomId), message);
  };

  // The socket listeners below are registered once per room and reach the
  // latest handlers through this ref (filled in a layout effect further down),
  // so the effect depends on roomId only.
  const handlersRef = useRef<CallHandlers | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const id = String(roomId);
    const handlers = () => handlersRef.current!;
    // a re-run (React's dev double effect, a new room) ignores the acks meant for the old run
    let active = true;

    // relayed by the server with who sent it; a signal of another room is stale
    const forRoom = (handle: (signal: CallSignal) => void) => (message: unknown) => {
      if (isCallSignal(message) && message.roomId === id) {
        handle(message);
      }
    };
    const onReady = forRoom((message) => handlers().handleReady(message));
    const onOffer = forRoom((message) => handlers().handleOffer(message));
    const onAnswer = forRoom((message) => handlers().handleAnswer(message));
    const onIceCandidate = forRoom((message) => handlers().handleIceCandidate(message));
    const onMedia = forRoom((message) => handlers().handleMedia(message));

    const onPeerLeft = (payload: { roomId?: unknown; from?: unknown }) => {
      if (payload?.roomId === id && typeof payload.from === "string") {
        handlers().handlePeerLeft(payload.from);
      }
    };

    // the callee declined (sent to our user room, so check the room id)
    const onDeclined = (payload: { roomId?: unknown }) => {
      if (payload?.roomId === id) {
        handlers().handleDeclined();
      }
    };

    // the socket reconnected: the server took the old one out of the call room
    const onConnect = () => handlers().handleReconnected();

    socket.on("call:ready", onReady);
    socket.on("call:offer", onOffer);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice-candidate", onIceCandidate);
    socket.on("call:media", onMedia);
    socket.on("call:peer-left", onPeerLeft);
    socket.on("call:declined", onDeclined);
    socket.on("connect", onConnect);

    socket.emit("call:join", id, (res: JoinResult) => {
      if (active) {
        handlers().handleJoined(res);
      }
    });

    return () => {
      active = false;
      socket.off("call:ready", onReady);
      socket.off("call:offer", onOffer);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:media", onMedia);
      socket.off("call:peer-left", onPeerLeft);
      socket.off("call:declined", onDeclined);
      socket.off("connect", onConnect);
      socket.emit("call:leave", id);
    };
  }, [roomId]);

  const updatePeer = (peerId: string, patch: Partial<RemotePeer>) =>
    setPeers((list) => list.map((peer) => (peer.id === peerId ? { ...peer, ...patch } : peer)));

  const addPeer = (peerId: string, userId: string) => {
    if (peerUsers.current.has(peerId) || peerId === getSocket().id) {
      return;
    }
    const stream = new MediaStream();
    peerUsers.current.set(peerId, userId);
    remoteStreams.current.set(peerId, stream);
    hadPeer.current = true;
    setPeers((list) => [
      ...list,
      {
        id: peerId,
        userId,
        state: "connecting",
        // both sides join the same kind of call, so an audio call starts camera off
        media: { mic: true, camera: !audioOnly },
        stream,
      },
    ]);
  };

  const closeConnection = (connection: RTCPeerConnection) => {
    connection.onicecandidate = null;
    connection.ontrack = null;
    connection.onconnectionstatechange = null;
    connection.close();
  };

  // Drops a peer and our connection to it; `quietly`: without leaving when it was the last one
  // (a reconnect clears every peer before joining again)
  const removePeer = (peerId: string, quietly = false) => {
    if (!peerUsers.current.has(peerId)) {
      return;
    }
    const connection = connections.current.get(peerId);
    if (connection) {
      closeConnection(connection);
    }
    remoteStreams.current.get(peerId)?.getTracks().forEach((track) => track.stop());
    connections.current.delete(peerId);
    remoteStreams.current.delete(peerId);
    peerUsers.current.delete(peerId);
    setPeers((list) => list.filter((peer) => peer.id !== peerId));
    if (!quietly && peerUsers.current.size === 0 && hadPeer.current) {
      leaveRoom();
    }
  };

  // Our tracks on a new connection: the mic, and the screen (while sharing) or the camera.
  // True when a video track went on.
  const addLocalTracks = (connection: RTCPeerConnection) => {
    const stream = userStream.current;
    if (!stream) {
      return false;
    }
    stream.getAudioTracks().forEach((track) => connection.addTrack(track, stream));
    const video = screenTrack.current ?? stream.getVideoTracks()[0];
    if (video) {
      connection.addTrack(video, stream);
    }
    return !!video;
  };

  // A negotiation with a peer that starts again (its offer arriving again, a re-join) replaces
  // that connection: the old one is closed, and every async step below works on its own
  // connection and stops once it is no longer the current one for that peer. Before, a late offer /
  // answer of the old connection was set on the new one ("The SDP does not match").
  const createPeerConnection = (peerId: string) => {
    const previous = connections.current.get(peerId);
    if (previous) {
      closeConnection(previous);
      // its remote tracks ended with it; the new connection brings its own
      const stream = remoteStreams.current.get(peerId);
      stream?.getTracks().forEach((track) => stream.removeTrack(track));
    }
    const connection = new RTCPeerConnection({ iceServers });
    connections.current.set(peerId, connection);
    const current = () => connections.current.get(peerId) === connection;

    connection.onicecandidate = (event) => {
      if (event.candidate && current()) {
        signal("call:ice-candidate", { to: peerId, data: event.candidate });
      }
    };
    connection.ontrack = (event) => {
      remoteStreams.current.get(peerId)?.addTrack(event.track);
    };
    connection.onicecandidateerror = (e) => console.log(e);
    connection.onconnectionstatechange = () => {
      if (!current()) {
        return;
      }
      switch (connection.connectionState) {
        case "connected":
          updatePeer(peerId, { state: "connected" });
          // keep the start time across a reconnect and later peers
          setConnectedAt((prev) => prev ?? Date.now());
          // the other side starts from "mic and camera on"
          signal("call:media", { to: peerId, data: localMedia.current });
          break;
        case "disconnected":
          updatePeer(peerId, { state: "reconnecting" });
          break;
        case "failed":
          updatePeer(peerId, { state: "failed" });
          break;
      }
    };
    return connection;
  };

  // We send the offer to this peer (isOfferer). Once per peer: a connection being set up or up
  // is kept (a ready that crossed ours would otherwise start a second negotiation).
  const offerTo = (peerId: string) => {
    const existing = connections.current.get(peerId);
    if (existing && existing.connectionState !== "failed" && existing.connectionState !== "closed") {
      return;
    }
    const connection = createPeerConnection(peerId);
    // an audio call still negotiates video, so either side can turn its
    // camera on later with replaceTrack, without a new offer / answer
    if (!addLocalTracks(connection)) {
      connection.addTransceiver("video", { direction: "sendrecv" });
    }
    connection
      .createOffer()
      .then(async (offer) => {
        if (connections.current.get(peerId) !== connection) {
          return; // replaced meanwhile
        }
        await connection.setLocalDescription(offer);
        signal("call:offer", { to: peerId, data: offer });
      })
      .catch((error) => console.log(error));
  };

  const handleJoined = (res: JoinResult) => {
    if (!res.ok) {
      if (res.reason === "full") {
        toast.error(t("room_full"));
      }
      router.push(`/conversations/${roomId}`);
      return;
    }
    joinedAs.current = getSocket().id;
    res.peers?.forEach((peer) => addPeer(peer.id, peer.userId));
    // joined again after a reconnect: everybody else left meanwhile
    if (peerUsers.current.size === 0 && hadPeer.current) {
      leaveRoom();
      return;
    }
    if (ready.current) {
      signal("call:ready");
      return;
    }
    if (mediaRequested.current) {
      return;
    }
    mediaRequested.current = true;
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: audioOnly ? false : { width: 1280, height: 720 },
      })
      .then((stream) => {
        if (left.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        /* store reference to the stream and provide it to the video element */
        userStream.current = stream;
        userVideo.current!.srcObject = stream;
        userVideo.current!.onloadedmetadata = () => {
          userVideo.current!.play();
        };
        ready.current = true;
        setMediaReady(true);
        // the peers already in (or joining meanwhile) connect to us from here
        signal("call:ready");
      })
      .catch((err) => {
        // permission denied or no camera/mic: leave instead of a silent black screen
        console.log(err);
        toast.error(t("media_error"));
        leaveRoom();
      });
  };

  // A peer whose camera / mic are up. Ours are up too: tell it back (once, to that peer) so it
  // knows, then the offerer of the two starts. Not up yet: our own call:ready follows, and it
  // answers that one.
  const handleReady = ({ from, userId, data }: CallSignal) => {
    addPeer(from, userId);
    if (!ready.current) {
      return;
    }
    const reply = (data as { reply?: unknown } | undefined)?.reply === true;
    if (!reply) {
      signal("call:ready", { to: from, data: { reply: true } });
    }
    const ownId = getSocket().id;
    if (ownId && isOfferer(ownId, from)) {
      offerTo(from);
    }
  };

  const handleOffer = ({ from, userId, data }: CallSignal) => {
    if (!isDescription(data, "offer")) {
      return;
    }
    addPeer(from, userId);
    const connection = createPeerConnection(from);
    // added before the offer is applied, so they go on the offer's transceivers
    addLocalTracks(connection);
    connection
      .setRemoteDescription(data)
      .then(() => {
        // the offer's video transceiver (audio call, or our camera not added):
        // answer sendrecv so our camera can be switched on later
        connection.getTransceivers().forEach((transceiver) => {
          if (
            transceiver.receiver.track.kind === "video" &&
            transceiver.direction === "recvonly"
          ) {
            transceiver.direction = "sendrecv";
          }
        });
        return connection.createAnswer();
      })
      .then(async (answer) => {
        if (connections.current.get(from) !== connection) {
          return; // a newer offer replaced this one
        }
        await connection.setLocalDescription(answer);
        signal("call:answer", { to: from, data: answer });
      })
      .catch((error) => console.log(error));
  };

  const handleAnswer = ({ from, data }: CallSignal) => {
    const connection = connections.current.get(from);
    // only the answer to our current offer: one to an offer we replaced is late
    if (!connection || connection.signalingState !== "have-local-offer" || !isDescription(data, "answer")) {
      return;
    }
    connection.setRemoteDescription(data).catch((error) => console.log(error));
  };

  const handleIceCandidate = ({ from, data }: CallSignal) => {
    if (typeof data !== "object" || data === null) {
      return;
    }
    // none yet, or one of a connection that was replaced: dropped
    connections.current
      .get(from)
      ?.addIceCandidate(new RTCIceCandidate(data as RTCIceCandidateInit))
      .catch((error) => console.log(error));
  };

  // a peer's mic / camera / screen (relayed as-is, so validate it)
  const handleMedia = ({ from, data }: CallSignal) => {
    if (isMediaState(data) && peerUsers.current.has(from)) {
      updatePeer(from, { media: { mic: data.mic, camera: data.camera, screen: data.screen === true } });
    }
  };

  const handlePeerLeft = (peerId: string) => {
    const userId = peerUsers.current.get(peerId);
    if (!userId) {
      return;
    }
    removePeer(peerId);
    // a group call goes on: say who left
    if (isGroup && peerUsers.current.size > 0) {
      toast(t("peer_left", { name: nameOf(userId) }), { icon: "👋" });
    }
  };

  // The socket reconnected (new id, out of the call room): drop every connection and join again;
  // the others connect to the new socket as to a newcomer.
  const handleReconnected = () => {
    if (!joinedAs.current || joinedAs.current === getSocket().id || left.current) {
      return;
    }
    Array.from(peerUsers.current.keys()).forEach((peerId) => removePeer(peerId, true));
    getSocket().emit("call:join", String(roomId), (res: JoinResult) => handlersRef.current?.handleJoined(res));
  };

  // every connection's video sender (the video transceiver, negotiated in every call)
  const videoSenders = () =>
    Array.from(connections.current.values()).flatMap((connection) => {
      const sender = connection
        .getTransceivers()
        .find((transceiver) => transceiver.receiver.track.kind === "video")?.sender;
      return sender ? [sender] : [];
    });

  const replaceVideo = (track: MediaStreamTrack | null) =>
    Promise.all(
      videoSenders().map((sender) => sender.replaceTrack(track).catch((error) => console.log(error)))
    );

  // Camera off releases the camera (its light goes off) and sends no video;
  // the others show our avatar from call:media.
  const stopCamera = () => {
    const stream = userStream.current;
    stream?.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
    // while sharing, the screen keeps the video senders
    if (!screenTrack.current) {
      void replaceVideo(null);
    }
  };

  // Camera on (also an audio call switching to video): grab the camera and send
  // it on the video transceivers, no new offer / answer needed. False if the
  // camera is unavailable (denied, none), with a toast.
  const startingCamera = useRef(false);
  const startCamera = async () => {
    if (startingCamera.current) {
      return false;
    }
    startingCamera.current = true;
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
      const track = camera.getVideoTracks()[0];
      const stream = userStream.current;
      if (!stream) {
        track.stop();
        return false;
      }
      stream.addTrack(track);
      // re-attach so the self view picks up the new track
      userVideo.current!.srcObject = null;
      userVideo.current!.srcObject = stream;
      // while sharing, the camera only shows in the self view until the sharing stops
      if (!screenTrack.current) {
        await replaceVideo(track);
      }
      return true;
    } catch (error) {
      console.log(error);
      toast.error(t("camera_error"));
      return false;
    } finally {
      startingCamera.current = false;
    }
  };

  const toggleMediaStream = (type: "audio", state: boolean) => {
    userStream.current?.getTracks().forEach((track) => {
      if (track.kind === type) {
        track.enabled = !state;
      }
    });
  };

  const leaveRoom = () => {
    if (left.current) {
      return;
    }
    left.current = true;
    screenTrack.current?.stop();
    screenTrack.current = null;
    userStream.current?.getTracks().forEach((track) => track.stop());
    connections.current.forEach(closeConnection);
    connections.current.clear();
    remoteStreams.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    router.push(`/conversations/${roomId}`);
  };

  const anyConnected = peers.some((peer) => peer.state === "connected");
  const status: CallStatus = !mediaReady
    ? "connecting"
    : peers.length === 0
      ? "waiting"
      : anyConnected
        ? "connected"
        : peers.some((peer) => peer.state === "reconnecting")
          ? "reconnecting"
          : peers.every((peer) => peer.state === "failed")
            ? "failed"
            : "connecting";

  // ringback while we wait for somebody to pick up
  useCallTone("ringback", status === "waiting");

  // only while still ringing: a decline from the callee's other tab must not end
  // a call they already answered
  const handleDeclined = () => {
    if (status !== "waiting") {
      return;
    }
    toast(t("declined", { name: callName }), { icon: "📵" });
    leaveRoom();
  };

  const handleNoAnswer = () => {
    if (status !== "waiting") {
      return;
    }
    toast(isGroup ? t("no_answer_group") : t("no_answer", { name: callName }), { icon: "📞" });
    getSocket().emit("call:cancel", String(roomId));
    leaveRoom();
  };

  // the leave button: while still ringing, also stop the ringing on the other side
  const hangUp = () => {
    if (status === "waiting") {
      getSocket().emit("call:cancel", String(roomId));
    }
    leaveRoom();
  };

  const updateLocalMedia = (media: MediaState) => {
    localMedia.current = media;
    signal("call:media", { data: media });
  };

  const toggleMic = () => {
    toggleMediaStream("audio", micActive);
    setMicActive(!micActive);
    updateLocalMedia({ mic: !micActive, camera: cameraActive, screen: sharing });
  };

  const toggleCamera = async () => {
    if (cameraActive) {
      stopCamera();
    } else if (!(await startCamera())) {
      return;
    }
    setCameraActive(!cameraActive);
    updateLocalMedia({ mic: micActive, camera: !cameraActive, screen: sharing });
  };

  // Screen sharing: the screen replaces the camera on every video sender (no new offer / answer);
  // stopping (here or the browser's own "Stop sharing") puts the camera back when it is on.
  const stopSharing = () => {
    const track = screenTrack.current;
    if (!track) {
      return;
    }
    screenTrack.current = null;
    track.onended = null;
    track.stop();
    void replaceVideo(userStream.current?.getVideoTracks()[0] ?? null);
    setSharing(false);
    updateLocalMedia({ ...localMedia.current, screen: false });
  };

  const startSharing = async () => {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (error) {
      // NotAllowedError: the user closed the picker
      if ((error as DOMException)?.name !== "NotAllowedError") {
        toast.error(t("share_error"));
      }
      return;
    }
    const track = display.getVideoTracks()[0];
    if (!track || videoSenders().length === 0) {
      display.getTracks().forEach((item) => item.stop());
      toast.error(t("share_error"));
      return;
    }
    // text and slides stay sharp rather than smooth
    track.contentHint = "detail";
    screenTrack.current = track;
    track.onended = stopSharing;
    await replaceVideo(track);
    setSharing(true);
    updateLocalMedia({ ...localMedia.current, screen: true });
  };

  const toggleSharing = () => (sharing ? stopSharing() : startSharing());

  // Layout effects run before every passive effect, so the socket listeners
  // above always find handlers here.
  useLayoutEffect(() => {
    handlersRef.current = {
      handleJoined,
      handleReconnected,
      handleReady,
      handleOffer,
      handleAnswer,
      handleIceCandidate,
      handleMedia,
      handlePeerLeft,
      handleDeclined,
      handleNoAnswer,
    };
  });

  // give up when nobody picks up; the timer stops once somebody joins
  useEffect(() => {
    if (status !== "waiting") {
      return;
    }
    const id = setTimeout(
      () => handlersRef.current?.handleNoAnswer(),
      CALL_RING_TIMEOUT_MS
    );
    return () => clearTimeout(id);
  }, [status]);

  const statusText =
    status === "connected" && connectedAt !== null ? (
      <CallTimer since={connectedAt} />
    ) : status === "waiting" ? (
      t("status_waiting", { name: callName })
    ) : status === "reconnecting" ? (
      t("status_reconnecting")
    ) : status === "failed" ? (
      t("status_failed")
    ) : (
      t("status_connecting")
    );

  const connected = status === "connected";
  // one other peer (a 1:1 call, or a group call of two so far): full screen; more: a grid
  const single = peers.length === 1 ? peers[0] : null;
  const sharers = peers.filter((peer) => peer.state === "connected" && peer.media.screen);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-neutral-950 text-white">
      <Header
        conversation={conversation}
        status={statusText}
        remoteMuted={!!single && single.state === "connected" && !single.media.mic && !isGroup}
        participants={isGroup && peers.length > 0 ? peers.length + 1 : undefined}
      />

      {peers.length === 0 && (
        // nobody else yet: who we are calling
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-neutral-900 px-6 text-center">
          <CallAvatar
            image={isGroup ? conversation.image : otherUser?.image}
            alt={tCommon("avatar")}
            pulse
            className={clsx(audioOnly ? "h-32 w-32 sm:h-40 sm:w-40" : "h-28 w-28 sm:h-32 sm:w-32")}
          />
          <div className="space-y-1">
            <div className="text-xl font-semibold">{callName}</div>
            <div className="text-sm tabular-nums text-white/60">{statusText}</div>
            {audioOnly && (
              <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-white/40">
                <HiPhone size={12} aria-hidden />
                {t("audio_call")}
              </div>
            )}
          </div>
        </div>
      )}

      {single && (
        <PeerTile
          peer={single}
          user={userOf(single.userId)}
          name={isGroup ? nameOf(single.userId) : callName}
          audioOnly={audioOnly}
          large
          status={statusText}
        />
      )}

      {peers.length > 1 && (
        <div
          className={clsx(
            "absolute inset-0 grid auto-rows-fr gap-2 px-2 pb-28 pt-24",
            peers.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"
          )}>
          {peers.map((peer) => (
            <PeerTile
              key={peer.id}
              peer={peer}
              user={userOf(peer.userId)}
              name={nameOf(peer.userId)}
              audioOnly={audioOnly}
              large={false}
              status={statusText}
            />
          ))}
        </div>
      )}

      {(sharing || sharers.length > 0) && (
        <div className="absolute left-1/2 top-24 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium backdrop-blur">
          <HiComputerDesktop size={14} className="shrink-0" aria-hidden />
          <span className="truncate">
            {sharing
              ? t("sharing_you")
              : t("sharing_other", { name: isGroup ? nameOf(sharers[0].userId) : callName })}
          </span>
        </div>
      )}

      {/* self view: top right on phones (clear of the controls), bottom right from sm.
          Kept mounted in audio calls too: the handlers use its ref */}
      <div className={clsx(audioOnly && !cameraActive && "hidden", "absolute right-4 top-24 z-10 aspect-[3/4] w-28 overflow-hidden rounded-2xl bg-neutral-800 shadow-2xl ring-1 ring-white/15 sm:bottom-28 sm:top-auto sm:aspect-video sm:w-56 lg:w-72", peers.length > 1 && "sm:w-44 lg:w-56")}>
        <video
          className={clsx(
            "h-full w-full -scale-x-100 object-cover",
            !cameraActive && "invisible"
          )}
          muted
          autoPlay
          playsInline
          ref={userVideo}
        />
        {!cameraActive && (
          <div className="absolute inset-0 flex items-center justify-center">
            <CallAvatar
              image={user.image}
              alt={tCommon("avatar")}
              className="h-12 w-12 sm:h-16 sm:w-16"
            />
          </div>
        )}
        <div className="absolute bottom-1.5 left-2 flex items-center gap-1 text-xs font-medium text-white drop-shadow">
          {!micActive && (
            <FaMicrophoneSlash
              size={11}
              className="text-red-400"
              aria-label={t("muted")}
            />
          )}
          {t("you")}
        </div>
      </div>

      <Footer
        micActive={micActive}
        cameraActive={cameraActive}
        toggleMic={toggleMic}
        toggleCamera={toggleCamera}
        sharing={sharing}
        // only once a peer is connected: the video senders exist then
        toggleSharing={shareSupported && connected ? toggleSharing : undefined}
        leaveRoom={hangUp}
      />
    </div>
  );
};

export default Body;
