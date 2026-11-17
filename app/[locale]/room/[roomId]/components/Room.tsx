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

interface MediaState {
  mic: boolean;
  camera: boolean;
  // sharing the screen (sent instead of the camera); missing from older clients
  screen?: boolean;
}

const isMediaState = (value: unknown): value is MediaState =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as MediaState).mic === "boolean" &&
  typeof (value as MediaState).camera === "boolean" &&
  ["boolean", "undefined"].includes(typeof (value as MediaState).screen);

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
  user?: SafeUser;
  alt: string;
  pulse?: boolean;
  className?: string;
}> = ({ user, alt, pulse, className }) => (
  <div className={clsx("relative", className)}>
    {pulse && (
      <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />
    )}
    <div className="relative h-full w-full overflow-hidden rounded-full ring-4 ring-white/10">
      <Image
        fill
        sizes="128px"
        className="object-cover"
        src={user?.image || "/images/placeholder.jpg"}
        alt={alt}
      />
    </div>
  </div>
);

interface CallHandlers {
  handleRoomJoined: () => void;
  initiateCall: () => void;
  handleReceivedOffer: (offer: RTCSessionDescriptionInit) => void;
  handleAnswerReceived: (answer: RTCSessionDescriptionInit) => void;
  handlerNewIceCandidateMsg: (candidate: RTCIceCandidate) => void;
  leaveRoom: () => void;
  handleDeclined: () => void;
  handleNoAnswer: () => void;
  backToConversation: () => void;
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
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  // both peers join the same kind of call, so an audio call starts camera off
  const [remoteMedia, setRemoteMedia] = useState<MediaState>({
    mic: true,
    camera: !audioOnly,
  });
  const otherUser = useOtherUser(conversation);
  const otherName = conversation.name || otherUser?.name || "";

  const t = useTranslations("call");
  const tCommon = useTranslations("common");
  const router = useRouter();

  // ringback while the host waits for the other side to pick up
  useCallTone("ringback", status === "waiting");

  const host = useRef(false);

  // our mic / camera state, for handlers created outside render (peer connection)
  const localMedia = useRef<MediaState>({ mic: true, camera: !audioOnly });

  // Webrtc refs
  const rtcConnection = useRef<RTCPeerConnection | null>(null);
  const userStream = useRef<MediaStream | undefined>(undefined);

  const userVideo = useRef<HTMLVideoElement>(null);
  const partnerVideo = useRef<HTMLVideoElement>(null);
  // the other side's tracks, collected from ontrack: a video transceiver added
  // without a track (audio call) arrives with no stream of its own
  const remoteStream = useRef<MediaStream | null>(null);

  // Sends a signalling message to the other peer through the socket server
  const signal = (event: string, payload?: unknown) => {
    getSocket().emit(event, String(roomId), payload);
  };

  // The socket listeners below are registered once per room and reach the
  // latest handlers through this ref (filled in a layout effect further down),
  // so the effect depends on roomId only.
  const handlersRef = useRef<CallHandlers | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const id = String(roomId);
    const handlers = () => handlersRef.current!;

    // offer is sent by the host, so only non-host should handle it
    const onOffer = (offer: RTCSessionDescriptionInit) => {
      if (!host.current) {
        handlers().handleReceivedOffer(offer);
      }
    };

    // When the second peer tells host they are ready to start the call
    // This happens after the second peer has grabbed their media
    const onReady = () => {
      handlers().initiateCall();
    };

    // answer is sent by non-host, so only host should handle it
    const onAnswer = (answer: RTCSessionDescriptionInit) => {
      if (host.current) {
        handlers().handleAnswerReceived(answer);
      }
    };

    const onIceCandidate = (iceCandidate: RTCIceCandidate) => {
      handlers().handlerNewIceCandidateMsg(iceCandidate);
    };

    // the other peer's mic / camera state (relayed as-is, so validate it)
    const onMedia = (media: unknown) => {
      if (isMediaState(media)) {
        setRemoteMedia({ mic: media.mic, camera: media.camera, screen: media.screen === true });
      }
    };

    // when the other peer leaves the call
    const onPeerLeft = () => {
      handlers().leaveRoom();
    };

    // the callee declined (sent to our user room, so check the room id)
    const onDeclined = (payload: { roomId?: unknown }) => {
      if (payload?.roomId === id) {
        handlers().handleDeclined();
      }
    };

    socket.on("call:offer", onOffer);
    socket.on("call:declined", onDeclined);
    socket.on("call:ready", onReady);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice-candidate", onIceCandidate);
    socket.on("call:media", onMedia);
    socket.on("call:peer-left", onPeerLeft);

    // the first peer to join the room is the host
    socket.emit(
      "call:join",
      id,
      (res: { ok: boolean; isHost?: boolean }) => {
        if (!res.ok) {
          handlers().backToConversation();
          return;
        }
        host.current = !!res.isHost;
        handlers().handleRoomJoined();
      }
    );

    return () => {
      socket.off("call:offer", onOffer);
      socket.off("call:declined", onDeclined);
      socket.off("call:ready", onReady);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:media", onMedia);
      socket.off("call:peer-left", onPeerLeft);
      socket.emit("call:leave", id);
    };
  }, [roomId]);

  const handleRoomJoined = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: audioOnly ? false : { width: 1280, height: 720 },
      })
      .then((stream) => {
        /* store reference to the stream and provide it to the video element */
        userStream.current = stream;
        userVideo.current!.srcObject = stream;
        userVideo.current!.onloadedmetadata = () => {
          userVideo.current!.play();
        };
        if (host.current) {
          setStatus("waiting");
        } else {
          // the 2nd peer joining will tell to host they are ready
          signal("call:ready");
        }
      })
      .catch((err) => {
        // permission denied or no camera/mic: leave instead of a silent black screen
        console.log(err);
        toast.error(t("media_error"));
        router.push(`/conversations/${roomId}`);
      });
  };

  const createPeerConnection = () => {
    // We create a RTC Peer Connection
    const connection = new RTCPeerConnection({ iceServers });

    // We implement our onicecandidate method for when we received a ICE candidate from the STUN server
    connection.onicecandidate = handleICECandidateEvent;

    // We implement our onTrack method for when we receive tracks
    connection.ontrack = handleTrackEvent;
    connection.onicecandidateerror = (e) => console.log(e);
    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case "connected":
          setStatus("connected");
          // keep the start time across a reconnect
          setConnectedAt((prev) => prev ?? Date.now());
          // the other side starts from "mic and camera on"
          signal("call:media", localMedia.current);
          break;
        case "disconnected":
          setStatus("reconnecting");
          break;
        case "failed":
          setStatus("failed");
          break;
      }
    };
    return connection;
  };

  const initiateCall = () => {
    if (host.current) {
      setStatus("connecting");
      rtcConnection.current = createPeerConnection();
      // Host creates offer
      userStream.current?.getTracks().forEach((track) => {
        rtcConnection.current?.addTrack(track, userStream.current!);
      });
      // an audio call still negotiates video, so either side can turn its
      // camera on later with replaceTrack, without a new offer / answer
      if (!userStream.current?.getVideoTracks().length) {
        rtcConnection.current.addTransceiver("video", { direction: "sendrecv" });
      }
      rtcConnection
        .current!.createOffer()
        .then((offer) => {
          rtcConnection.current!.setLocalDescription(offer);
          // Send offer to the other peer via the socket server
          signal("call:offer", offer);
        })
        .catch((error) => {
          console.log(error);
        });
    }
  };

  const handleReceivedOffer = (offer: RTCSessionDescriptionInit) => {
    rtcConnection.current = createPeerConnection();
    userStream.current?.getTracks().forEach((track) => {
      // Adding tracks to the RTCPeerConnection to give peer access to it
      rtcConnection.current?.addTrack(track, userStream.current!);
    });

    const connection = rtcConnection.current;
    connection
      .setRemoteDescription(offer)
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
      .then((answer) => {
        rtcConnection.current!.setLocalDescription(answer);
        signal("call:answer", answer);
      })
      .catch((error) => {
        console.log(error);
      });
  };

  const handleAnswerReceived = (answer: RTCSessionDescriptionInit) => {
    rtcConnection
      .current!.setRemoteDescription(answer)
      .catch((error) => console.log(error));
  };

  const handleICECandidateEvent = async (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate) {
      signal("call:ice-candidate", event.candidate);
    }
  };

  const handlerNewIceCandidateMsg = (incoming: RTCIceCandidate) => {
    // We cast the incoming candidate to RTCIceCandidate
    const candidate = new RTCIceCandidate(incoming);
    rtcConnection
      .current!.addIceCandidate(candidate)
      .catch((error) => console.log(error));
  };

  const handleTrackEvent = (event: RTCTrackEvent) => {
    if (!remoteStream.current) {
      remoteStream.current = new MediaStream();
      partnerVideo.current!.srcObject = remoteStream.current;
    }
    remoteStream.current.addTrack(event.track);
  };

  // the video transceiver, negotiated in every call (see initiateCall)
  const videoSender = () =>
    rtcConnection.current
      ?.getTransceivers()
      .find((transceiver) => transceiver.receiver.track.kind === "video")?.sender;

  // Camera off releases the camera (its light goes off) and sends no video;
  // the other side shows our avatar from call:media.
  const stopCamera = () => {
    const stream = userStream.current;
    stream?.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
    // while sharing, the screen keeps the video sender
    if (!screenTrack.current) {
      videoSender()
        ?.replaceTrack(null)
        .catch((error) => console.log(error));
    }
  };

  // Camera on (also an audio call switching to video): grab the camera and send
  // it on the video transceiver, no new offer / answer needed. False if the
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
        await videoSender()?.replaceTrack(track);
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

  // a camera turned on before the peer connection existed: added with the other
  // tracks in initiateCall / handleReceivedOffer

  const toggleMediaStream = (type: "audio", state: boolean) => {
    userStream.current?.getTracks().forEach((track) => {
      if (track.kind === type) {
        track.enabled = !state;
      }
    });
  };

  const leaveRoom = () => {
    screenTrack.current?.stop();
    screenTrack.current = null;
    if (userVideo.current!.srcObject) {
      (userVideo.current!.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop()); // Stops sending all tracks of User.
    }
    if (partnerVideo.current!.srcObject) {
      (partnerVideo.current!.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop()); // Stops receiving all tracks from Peer.
    }

    // Checks if there is peer on the other side and safely closes the existing connection established with the peer.
    if (rtcConnection.current) {
      rtcConnection.current.ontrack = null;
      rtcConnection.current.onicecandidate = null;
      rtcConnection.current.onconnectionstatechange = null;
      rtcConnection.current.close();
      rtcConnection.current = null;
    }

    router.push(`/conversations/${roomId}`);
  };

  // only while still ringing: a decline from the callee's other tab must not end
  // a call they already answered
  const handleDeclined = () => {
    if (status !== "waiting") {
      return;
    }
    toast(t("declined", { name: otherName }), { icon: "📵" });
    leaveRoom();
  };

  const handleNoAnswer = () => {
    if (status !== "waiting") {
      return;
    }
    toast(t("no_answer", { name: otherName }), { icon: "📞" });
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
    signal("call:media", media);
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

  // Screen sharing: the screen replaces the camera on the video sender (no new offer / answer);
  // stopping (here or the browser's own "Stop sharing") puts the camera back when it is on.
  const stopSharing = () => {
    const track = screenTrack.current;
    if (!track) {
      return;
    }
    screenTrack.current = null;
    track.onended = null;
    track.stop();
    const camera = userStream.current?.getVideoTracks()[0] ?? null;
    videoSender()
      ?.replaceTrack(camera)
      .catch((error) => console.log(error));
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
    const sender = videoSender();
    if (!track || !sender) {
      display.getTracks().forEach((item) => item.stop());
      toast.error(t("share_error"));
      return;
    }
    // text and slides stay sharp rather than smooth
    track.contentHint = "detail";
    screenTrack.current = track;
    track.onended = stopSharing;
    await sender.replaceTrack(track).catch((error) => console.log(error));
    setSharing(true);
    updateLocalMedia({ ...localMedia.current, screen: true });
  };

  const toggleSharing = () => (sharing ? stopSharing() : startSharing());

  // Layout effects run before every passive effect, so the socket listeners
  // above always find handlers here.
  useLayoutEffect(() => {
    handlersRef.current = {
      handleRoomJoined,
      initiateCall,
      handleReceivedOffer,
      handleAnswerReceived,
      handlerNewIceCandidateMsg,
      leaveRoom,
      handleDeclined,
      handleNoAnswer,
      backToConversation: () => router.push(`/conversations/${roomId}`),
    };
  });

  // give up when nobody picks up; the timer stops once the callee joins
  // (call:ready moves the status to "connecting")
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
      t("status_waiting", { name: otherName })
    ) : status === "reconnecting" ? (
      t("status_reconnecting")
    ) : status === "failed" ? (
      t("status_failed")
    ) : (
      t("status_connecting")
    );

  const connected = status === "connected";
  // cover the remote video until media flows, or while the other camera is off;
  // an audio call shows only this
  const showRemoteCover = !connected || (!remoteMedia.camera && !remoteMedia.screen);
  const remoteSharing = connected && remoteMedia.screen;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-neutral-950 text-white">
      <Header
        conversation={conversation}
        status={statusText}
        remoteMuted={connected && !remoteMedia.mic}
      />

      {/* remote video: always mounted, it also plays the other side's audio */}
      <video
        className="absolute inset-0 h-full w-full object-contain"
        autoPlay
        playsInline
        ref={partnerVideo}
      />

      {(sharing || remoteSharing) && (
        <div className="absolute left-1/2 top-24 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium backdrop-blur">
          <HiComputerDesktop size={14} aria-hidden />
          {sharing ? t("sharing_you") : t("sharing_other", { name: otherName })}
        </div>
      )}

      {showRemoteCover && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-neutral-900 px-6 text-center">
          <CallAvatar
            user={otherUser}
            alt={tCommon("avatar")}
            pulse={!connected}
            className={clsx(
              audioOnly ? "h-32 w-32 sm:h-40 sm:w-40" : "h-28 w-28 sm:h-32 sm:w-32"
            )}
          />
          <div className="space-y-1">
            <div className="text-xl font-semibold">{otherName}</div>
            <div className="text-sm tabular-nums text-white/60">
              {connected && !audioOnly
                ? t("camera_is_off", { name: otherName })
                : statusText}
            </div>
            {audioOnly && (
              <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-white/40">
                <HiPhone size={12} aria-hidden />
                {t("audio_call")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* self view: top right on phones (clear of the controls), bottom right from sm.
          Kept mounted in audio calls too: the handlers use its ref */}
      <div className={clsx(audioOnly && !cameraActive && "hidden", "absolute right-4 top-24 z-10 aspect-[3/4] w-28 overflow-hidden rounded-2xl bg-neutral-800 shadow-2xl ring-1 ring-white/15 sm:bottom-28 sm:top-auto sm:aspect-video sm:w-56 lg:w-72")}>
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
              user={user}
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
        // only once the call is up: the video sender exists then
        toggleSharing={shareSupported && connected ? toggleSharing : undefined}
        leaveRoom={hangUp}
      />
    </div>
  );
};

export default Body;
