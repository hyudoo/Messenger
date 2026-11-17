"use client";

import clsx from "clsx";
import {
  HiComputerDesktop,
  HiVideoCamera,
  HiVideoCameraSlash,
  HiPhoneXMark,
} from "react-icons/hi2";
import { FaMicrophoneSlash, FaMicrophone } from "react-icons/fa";
import { useTranslations } from "next-intl";

interface FooterProps {
  micActive: boolean;
  cameraActive: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  sharing: boolean;
  // missing where sharing isn't possible (phones, or before the call is up)
  toggleSharing?: () => void;
  leaveRoom: () => void;
}

const toggleClass = (active: boolean) =>
  clsx(
    "flex h-14 w-14 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
    active
      ? "bg-white/15 text-white backdrop-blur hover:bg-white/25"
      : "bg-white text-neutral-900 hover:bg-neutral-200"
  );

const Footer: React.FC<FooterProps> = ({
  micActive,
  cameraActive,
  toggleMic,
  toggleCamera,
  sharing,
  toggleSharing,
  leaveRoom,
}) => {
  const t = useTranslations("call");

  const cameraLabel = cameraActive ? t("camera_off") : t("camera_on");
  const micLabel = micActive ? t("mic_off") : t("mic_on");

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
      <div className="flex items-center gap-4 sm:gap-6">
        <button
          type="button"
          className={toggleClass(micActive)}
          aria-label={micLabel}
          aria-pressed={!micActive}
          title={micLabel}
          onClick={toggleMic}>
          {micActive ? (
            <FaMicrophone size={22} />
          ) : (
            <FaMicrophoneSlash size={22} />
          )}
        </button>
        <button
          type="button"
          className={toggleClass(cameraActive)}
          aria-label={cameraLabel}
          aria-pressed={!cameraActive}
          title={cameraLabel}
          onClick={toggleCamera}>
          {cameraActive ? (
            <HiVideoCamera size={24} />
          ) : (
            <HiVideoCameraSlash size={24} />
          )}
        </button>
        {toggleSharing && (
          <button
            type="button"
            // inverted while sharing, like a muted mic
            className={toggleClass(!sharing)}
            aria-label={sharing ? t("stop_share") : t("share_screen")}
            aria-pressed={sharing}
            title={sharing ? t("stop_share") : t("share_screen")}
            onClick={toggleSharing}>
            <HiComputerDesktop size={24} />
          </button>
        )}
        <button
          type="button"
          className="flex h-14 w-20 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label={t("leave")}
          title={t("leave")}
          onClick={leaveRoom}>
          <HiPhoneXMark size={26} />
        </button>
      </div>
    </div>
  );
};

export default Footer;
