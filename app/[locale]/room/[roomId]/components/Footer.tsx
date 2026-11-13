"use client";

import {
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
  leaveRoom: () => void;
}

const Footer: React.FC<FooterProps> = ({
  micActive,
  cameraActive,
  toggleMic,
  toggleCamera,
  leaveRoom,
}) => {
  const t = useTranslations("call");

  return (
    <div className="backdrop-opacity-10 fixed bottom-5 inset-x-2/4">
      <div className="flex justify-evenly gap-12">
        {cameraActive ? (
          <button
            type="button"
            className="bg-purple-500 p-3 cursor-pointer rounded-full"
            aria-label={t("camera_off")}
            onClick={() => toggleCamera()}>
            <HiVideoCamera size={24} className="text-white" />
          </button>
        ) : (
          <button
            type="button"
            className="bg-purple-500 p-3 cursor-pointer rounded-full"
            aria-label={t("camera_on")}
            onClick={() => toggleCamera()}>
            <HiVideoCameraSlash size={24} className="text-white" />
          </button>
        )}
        {micActive ? (
          <button
            type="button"
            className="bg-purple-500 p-3 cursor-pointer rounded-full"
            aria-label={t("mic_off")}
            onClick={() => toggleMic()}>
            <FaMicrophone size={24} className="text-white" />
          </button>
        ) : (
          <button
            type="button"
            className="bg-purple-500 p-3 cursor-pointer rounded-full"
            aria-label={t("mic_on")}
            onClick={() => toggleMic()}>
            <FaMicrophoneSlash size={24} className="text-white" />
          </button>
        )}
        <button
          type="button"
          className="bg-red-500 p-3 cursor-pointer rounded-full"
          aria-label={t("leave")}
            onClick={() => leaveRoom()}>
          <HiPhoneXMark size={24} className="text-white" />
        </button>
      </div>
    </div>
  );
};

export default Footer;
