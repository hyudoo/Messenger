"use client";

import { Conversation } from "@prisma/client";
import { SafeUser } from "@/app/types";
import { useEffect, useLayoutEffect, useRef, useMemo, useState } from "react";
import Footer from "./Footer";
import { toast } from "react-hot-toast";

import { getSocket } from "@/app/libs/socket-client";
import { useRouter } from "next/navigation";
import Header from "./Header";
import clsx from "clsx";
import Avatar from "@/app/components/Avatar";
import useOtherUser from "@/app/hooks/useOtherUser";

interface BodyProps {
  roomId: String;
  user: SafeUser;
  conversation: Conversation & {
    users: SafeUser[];
  };
}

interface CallHandlers {
  handleRoomJoined: () => void;
  initiateCall: () => void;
  handleReceivedOffer: (offer: RTCSessionDescriptionInit) => void;
  handleAnswerReceived: (answer: RTCSessionDescriptionInit) => void;
  handlerNewIceCandidateMsg: (candidate: RTCIceCandidate) => void;
  leaveRoom: () => void;
  backToConversation: () => void;
}

const ICE_SERVERS = {
  // you can add TURN servers here too
  iceServers: [
    {
      urls: "stun:openrelay.metered.ca:80",
    },
    {
      urls: "stun:stun.l.google.com:19302",
    },
    {
      urls: "stun:stun2.l.google.com:19302",
    },
  ],
};

const Body: React.FC<BodyProps> = ({ roomId, user, conversation }) => {
  const [micActive, setMicActive] = useState(true);
  const [cameraActive, setCameraActive] = useState(true);
  const otherUser = useOtherUser(conversation);

  const router = useRouter();

  const host = useRef(false);

  // Webrtc refs
  const rtcConnection = useRef<RTCPeerConnection | null>(null);
  const userStream = useRef<MediaStream | undefined>(undefined);

  const userVideo = useRef<HTMLVideoElement>(null);
  const partnerVideo = useRef<HTMLVideoElement>(null);

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

    // when the other peer leaves the call
    const onPeerLeft = () => {
      handlers().leaveRoom();
    };

    socket.on("call:offer", onOffer);
    socket.on("call:ready", onReady);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice-candidate", onIceCandidate);
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
      socket.off("call:ready", onReady);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:peer-left", onPeerLeft);
      socket.emit("call:leave", id);
    };
  }, [roomId]);

  const handleRoomJoined = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: { width: 1280, height: 720 },
      })
      .then((stream) => {
        /* store reference to the stream and provide it to the video element */
        userStream.current = stream;
        userVideo.current!.srcObject = stream;
        userVideo.current!.onloadedmetadata = () => {
          userVideo.current!.play();
        };
        if (!host.current) {
          // the 2nd peer joining will tell to host they are ready
          signal("call:ready");
        }
      })
      .catch((err) => {
        // permission denied or no camera/mic: leave instead of a silent black screen
        console.log(err);
        toast.error("Không thể truy cập camera hoặc micro!");
        router.push(`/conversations/${roomId}`);
      });
  };

  const createPeerConnection = () => {
    // We create a RTC Peer Connection
    const connection = new RTCPeerConnection(ICE_SERVERS);

    // We implement our onicecandidate method for when we received a ICE candidate from the STUN server
    connection.onicecandidate = handleICECandidateEvent;

    // We implement our onTrack method for when we receive tracks
    connection.ontrack = handleTrackEvent;
    connection.onicecandidateerror = (e) => console.log(e);
    return connection;
  };

  const initiateCall = () => {
    if (host.current) {
      rtcConnection.current = createPeerConnection();
      // Host creates offer
      userStream.current?.getTracks().forEach((track) => {
        rtcConnection.current?.addTrack(track, userStream.current!);
      });
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

    rtcConnection.current.setRemoteDescription(offer);
    rtcConnection.current
      .createAnswer()
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
    partnerVideo.current!.srcObject = event.streams[0];
  };

  const toggleMediaStream = (type: "video" | "audio", state: boolean) => {
    userStream.current!.getTracks().forEach((track) => {
      if (track.kind === type) {
        track.enabled = !state;
      }
    });
  };

  const leaveRoom = () => {
    // socketRef.current.emit('leave', roomName); // Let's the server know that user has left the room.

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
      rtcConnection.current.close();
      rtcConnection.current = null;
    }

    router.push(`/conversations/${roomId}`);
  };

  const toggleMic = () => {
    toggleMediaStream("audio", micActive);
    setMicActive((prev) => !prev);
  };

  const toggleCamera = () => {
    toggleMediaStream("video", cameraActive);
    setCameraActive((prev) => !prev);
  };

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
      backToConversation: () => router.push(`/conversations/${roomId}`),
    };
  });

  return (
    <div>
      <Header conversation={conversation!} />
      <div className="grid grid-cols-1 h-screen overflow-hidden">
        <video
          className={clsx(
            `w-1/4 
            h-1/4  
            rounded-md 
            fixed 
            right-2 
            bottom-2
            z-10
            `,
            !cameraActive && "hidden"
          )}
          muted
          autoPlay
          playsInline
          ref={userVideo}
        />
        <div
          className={clsx(
            `w-1/4 
            h-1/4 
            rounded-md 
            fixed
            right-2 
            bottom-2
            bg-black
            `,
            cameraActive && "hidden"
          )}>
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <Avatar user={user} />
          </div>
        </div>
        <video
          className="w-full h-full bg-black"
          autoPlay
          playsInline
          ref={partnerVideo}
        />
      </div>
      <Footer
        micActive={micActive}
        cameraActive={cameraActive}
        toggleMic={toggleMic}
        toggleCamera={toggleCamera}
        leaveRoom={leaveRoom}
      />
    </div>
  );
};

export default Body;
