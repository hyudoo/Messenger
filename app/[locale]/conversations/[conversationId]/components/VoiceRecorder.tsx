"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { HiMicrophone, HiPaperAirplane, HiTrash } from "react-icons/hi2";

import { AUDIO_TYPES, MAX_VOICE_MS, baseContentType } from "@/app/libs/upload";

// what MediaRecorder should write, best first (Safari only does mp4)
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

const pickMimeType = () =>
  MIME_CANDIDATES.find(
    (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
  );

// "1:05"
export const formatClock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export interface VoiceRecording {
  blob: Blob;
  type: string;
  duration: number;
}

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  send: boolean;
  limit: ReturnType<typeof setTimeout>;
}

// The microphone button and, while recording, a bar in place of the composer: cancel, the time,
// send. Stops by itself at MAX_VOICE_MS and sends.
export const useVoiceRecorder = (onRecorded: (recording: VoiceRecording) => void) => {
  const t = useTranslations("chat");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const session = useRef<Session | null>(null);
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  });

  // leaving the chat while recording drops the recording
  useEffect(
    () => () => {
      const current = session.current;
      if (current) {
        current.send = false;
        current.recorder.stop();
      }
    },
    []
  );

  useEffect(() => {
    if (!recording) {
      return;
    }
    const timer = setInterval(() => {
      if (session.current) {
        setElapsed(Date.now() - session.current.startedAt);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  const finish = (send: boolean) => {
    const current = session.current;
    if (!current) {
      return;
    }
    current.send = send;
    if (current.recorder.state !== "inactive") {
      current.recorder.stop();
    }
  };

  const start = async () => {
    const mimeType = pickMimeType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      toast.error(t("voice_unsupported"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t("mic_denied"));
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType });
    const current: Session = {
      recorder,
      stream,
      chunks: [],
      startedAt: Date.now(),
      send: false,
      limit: setTimeout(() => finish(true), MAX_VOICE_MS),
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        current.chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      clearTimeout(current.limit);
      current.stream.getTracks().forEach((track) => track.stop());
      session.current = null;
      setRecording(false);
      setElapsed(0);
      const type = baseContentType(recorder.mimeType || mimeType);
      const duration = Date.now() - current.startedAt;
      // a tap that ended at once isn't a message
      if (current.send && duration >= 500 && AUDIO_TYPES[type]) {
        onRecordedRef.current({ blob: new Blob(current.chunks, { type }), type, duration });
      }
    };
    session.current = current;
    recorder.start(250);
    setElapsed(0);
    setRecording(true);
  };

  return { recording, elapsed, start, cancel: () => finish(false), send: () => finish(true) };
};

interface MicButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const MicButton: React.FC<MicButtonProps> = ({ onClick, disabled }) => {
  const t = useTranslations("chat");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={t("record_voice")}
      title={t("record_voice")}
      className="text-sky-500 transition hover:text-sky-600 disabled:opacity-50">
      <HiMicrophone size={26} aria-hidden />
    </button>
  );
};

interface RecordingBarProps {
  elapsed: number;
  onCancel: () => void;
  onSend: () => void;
}

export const RecordingBar: React.FC<RecordingBarProps> = ({ elapsed, onCancel, onSend }) => {
  const t = useTranslations("chat");
  return (
    <div className="flex w-full items-center gap-3 px-4 py-4">
      <button
        type="button"
        onClick={onCancel}
        aria-label={t("cancel_voice")}
        title={t("cancel_voice")}
        className="rounded-full p-2 text-rose-500 transition hover:bg-muted">
        <HiTrash size={22} aria-hidden />
      </button>
      <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-sky-500 px-4 text-white" role="status">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" aria-hidden />
        <span className="text-sm">{t("recording")}</span>
        <span className="ml-auto text-sm tabular-nums">
          {formatClock(elapsed)} / {formatClock(MAX_VOICE_MS)}
        </span>
      </div>
      <button
        type="button"
        onClick={onSend}
        aria-label={t("send_voice")}
        title={t("send_voice")}
        className="rounded-full bg-sky-500 p-2 text-white transition hover:bg-sky-600">
        <HiPaperAirplane size={18} aria-hidden />
      </button>
    </div>
  );
};
