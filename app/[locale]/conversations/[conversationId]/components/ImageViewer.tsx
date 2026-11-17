"use client";

import Image from "next/image";
import { createContext, useContext, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  HiArrowDownTray,
  HiChevronLeft,
  HiChevronRight,
  HiMagnifyingGlassMinus,
  HiMagnifyingGlassPlus,
  HiXMark,
} from "react-icons/hi2";

// Opens the viewer on an image of the chat (MessageBox); null outside a chat.
const ImageViewerContext = createContext<((src: string) => void) | null>(null);
export const useOpenImage = () => useContext(ImageViewerContext);

// a horizontal swipe longer than this (px) goes to the next / previous image
const SWIPE_MIN = 50;
const ZOOM = 2.5;

interface ImageViewerProviderProps {
  // the chat's images, oldest first (the loaded pages)
  images: string[];
  children: React.ReactNode;
}

// The full-screen image viewer of a chat: every loaded image, with arrows / keys / swipes to move
// between them, zoom (click or tap the image; it follows the pointer) and download.
// Always dark, like the call screen: it shows media, not the app's surfaces.
export const ImageViewerProvider: React.FC<ImageViewerProviderProps> = ({ images, children }) => {
  // the image shown (its URL, so a page loading older images doesn't shift it), or null
  const [current, setCurrent] = useState<string | null>(null);

  return (
    <ImageViewerContext.Provider value={setCurrent}>
      {children}
      {current && (
        <Viewer
          // a fresh viewer (zoom off) for every image
          key={current}
          images={images.includes(current) ? images : [current]}
          current={current}
          onChange={setCurrent}
          onClose={() => setCurrent(null)}
        />
      )}
    </ImageViewerContext.Provider>
  );
};

interface ViewerProps {
  images: string[];
  current: string;
  onChange: (src: string) => void;
  onClose: () => void;
}

const Viewer: React.FC<ViewerProps> = ({ images, current, onChange, onClose }) => {
  const t = useTranslations("viewer");
  const [zoomed, setZoomed] = useState(false);
  // where the zoom is centred, in % of the image
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const index = images.indexOf(current);
  const previous = index > 0 ? images[index - 1] : null;
  const next = index < images.length - 1 ? images[index + 1] : null;

  const pointAt = (clientX: number, clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setOrigin({
      x: Math.min(Math.max(((clientX - rect.left) / rect.width) * 100, 0), 100),
      y: Math.min(Math.max(((clientY - rect.top) / rect.height) * 100, 0), 100),
    });
  };

  const download = async () => {
    const name = current.split("/").pop() || "image";
    try {
      // a cross-origin link ignores `download`: fetch it and save the blob instead
      const blob = await (await fetch(current)).blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // the bucket doesn't allow the fetch (CORS): open it, the browser can save it from there
      window.open(current, "_blank", "noopener,noreferrer");
    }
  };

  const button =
    "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30";

  return (
    <Dialog open onClose={onClose} className="relative z-[60]">
      <DialogPanel
        className="fixed inset-0 flex flex-col bg-black/95"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" && previous) {
            onChange(previous);
          } else if (event.key === "ArrowRight" && next) {
            onChange(next);
          }
        }}>
        <div className="flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <DialogTitle className="flex-1 text-sm text-white/80 tabular-nums">
            {images.length > 1 && t("counter", { current: index + 1, total: images.length })}
          </DialogTitle>
          <button
            type="button"
            className={button}
            onClick={() => setZoomed((value) => !value)}
            aria-label={zoomed ? t("zoom_out") : t("zoom_in")}
            title={zoomed ? t("zoom_out") : t("zoom_in")}>
            {zoomed ? <HiMagnifyingGlassMinus size={20} aria-hidden /> : <HiMagnifyingGlassPlus size={20} aria-hidden />}
          </button>
          <button type="button" className={button} onClick={download} aria-label={t("download")} title={t("download")}>
            <HiArrowDownTray size={20} aria-hidden />
          </button>
          <button type="button" className={button} onClick={onClose} aria-label={t("close")} title={t("close")} autoFocus>
            <HiXMark size={22} aria-hidden />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <button
            type="button"
            className={`${button} absolute left-3 z-10 hidden sm:flex`}
            onClick={() => previous && onChange(previous)}
            disabled={!previous}
            aria-label={t("previous")}>
            <HiChevronLeft size={22} aria-hidden />
          </button>
          <div
            className="relative h-full w-full touch-pan-y overflow-hidden"
            onClick={(event) => {
              pointAt(event.clientX, event.clientY, event.currentTarget);
              setZoomed((value) => !value);
            }}
            onMouseMove={(event) => zoomed && pointAt(event.clientX, event.clientY, event.currentTarget)}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              touchStart.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchMove={(event) => {
              if (zoomed) {
                const touch = event.touches[0];
                pointAt(touch.clientX, touch.clientY, event.currentTarget);
              }
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              touchStart.current = null;
              if (!start || zoomed) {
                return;
              }
              const touch = event.changedTouches[0];
              const dx = touch.clientX - start.x;
              if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(touch.clientY - start.y)) {
                // no zoom from the click that follows the swipe
                event.preventDefault();
                if (dx < 0 && next) {
                  onChange(next);
                } else if (dx > 0 && previous) {
                  onChange(previous);
                }
              }
            }}>
            <Image
              src={current}
              alt=""
              fill
              sizes="100vw"
              className={zoomed ? "cursor-zoom-out object-contain" : "cursor-zoom-in object-contain"}
              style={{
                transform: zoomed ? `scale(${ZOOM})` : undefined,
                transformOrigin: `${origin.x}% ${origin.y}%`,
                transition: "transform 150ms ease-out",
              }}
            />
          </div>
          <button
            type="button"
            className={`${button} absolute right-3 z-10 hidden sm:flex`}
            onClick={() => next && onChange(next)}
            disabled={!next}
            aria-label={t("next")}>
            <HiChevronRight size={22} aria-hidden />
          </button>
        </div>
      </DialogPanel>
    </Dialog>
  );
};
