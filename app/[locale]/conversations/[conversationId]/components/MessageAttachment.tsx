"use client";

import clsx from "clsx";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { HiOutlineDocument, HiPause, HiPlay } from "react-icons/hi2";

import { formatFileSize } from "@/app/libs/upload";
import { FullMessageType } from "@/app/types";
import { formatClock } from "./VoiceRecorder";

type Attachment = NonNullable<FullMessageType["attachment"]>;

interface Props {
  attachment: Attachment;
  // the user's own message: drawn on the blue bubble
  isOwn: boolean;
}

// A file message: its name, type and size; opens (or downloads) the file in a new tab.
export const FileCard: React.FC<Props> = ({ attachment, isOwn }) => {
  const t = useTranslations("chat");
  const extension = attachment.name.split(".").pop()?.toUpperCase();
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      aria-label={t("open_file", { name: attachment.name })}
      className="flex min-w-0 max-w-full items-center gap-3 sm:w-64">
      <span
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          isOwn ? "bg-white/20" : "bg-background"
        )}>
        <HiOutlineDocument size={22} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{attachment.name}</span>
        <span className={clsx("block text-xs", isOwn ? "text-sky-100" : "text-muted-foreground")}>
          {[extension, formatFileSize(attachment.size)].filter(Boolean).join(" · ")}
        </span>
      </span>
    </a>
  );
};

// A voice message: play / pause, a seekable progress bar and the time left.
export const VoicePlayer: React.FC<Props> = ({ attachment, isOwn }) => {
  const t = useTranslations("chat");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0); // ms
  // the recorder's length; the file's own may be unknown (webm) until it has played
  const [length, setLength] = useState(attachment.duration ?? 0);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      // only one voice message plays at a time
      document.querySelectorAll("audio").forEach((other) => other !== audio && other.pause());
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const seek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (audio && length > 0) {
      audio.currentTime = Number(event.target.value) / 1000;
      setPosition(Number(event.target.value));
    }
  };

  return (
    <div className="flex w-56 max-w-full items-center gap-2">
      <audio
        ref={audioRef}
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds) && seconds > 0) {
            setLength(seconds * 1000);
          }
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("pause") : t("play")}
        className={clsx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isOwn ? "bg-white text-sky-500" : "bg-sky-500 text-white"
        )}>
        {playing ? <HiPause size={16} aria-hidden /> : <HiPlay size={16} aria-hidden className="ml-0.5" />}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(Math.round(length), 1)}
        value={Math.round(position)}
        onChange={seek}
        aria-label={t("seek")}
        className={clsx("h-1 min-w-0 flex-1 cursor-pointer", isOwn ? "accent-white" : "accent-sky-500")}
      />
      <span className={clsx("w-9 shrink-0 text-right text-xs tabular-nums", isOwn ? "text-sky-100" : "text-muted-foreground")}>
        {formatClock(playing || position > 0 ? length - position : length)}
      </span>
    </div>
  );
};
