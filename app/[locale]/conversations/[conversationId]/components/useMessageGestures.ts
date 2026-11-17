"use client";

import { useEffect, useRef, useState } from "react";

// Touch gestures on a message bubble (mobile): tap (show the time), hold to open the
// message menu, swipe sideways (towards the middle of the screen) to reply.
// Mouse input never triggers them.
export const LONG_PRESS_MS = 450;
// how far (px) a swipe must pull the bubble to reply, and the most it moves
export const SWIPE_TRIGGER = 56;
const SWIPE_MAX = 72;
// movement (px) that cancels a hold and decides between swiping and scrolling
const MOVE_SLOP = 10;

type Mode = "idle" | "pending" | "swipe" | "scroll" | "pressed";

interface Options {
  // 1: swipe right (others' messages), -1: swipe left (own messages)
  direction: 1 | -1;
  onLongPress?: () => void;
  // undefined: this message can't be replied to (no swipe)
  onSwipe?: () => void;
  // a tap that didn't land on a link, button, image or control (those keep their own action)
  onTap?: () => void;
}

const vibrate = () => {
  // not on iOS Safari
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(10);
  }
};

const useMessageGestures = ({ direction, onLongPress, onSwipe, onTap }: Options) => {
  // how far the bubble is pulled, always >= 0 (the caller applies the direction)
  const [pull, setPull] = useState(0);
  const mode = useRef<Mode>("idle");
  const start = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 1) {
      clearTimer();
      mode.current = "idle";
      return;
    }
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
    mode.current = "pending";
    armed.current = false;
    if (onLongPress) {
      timer.current = setTimeout(() => {
        timer.current = null;
        mode.current = "pressed";
        vibrate();
        onLongPress();
      }, LONG_PRESS_MS);
    }
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    const dx = touch.clientX - start.current.x;
    const dy = touch.clientY - start.current.y;

    if (mode.current === "pending") {
      if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) {
        return;
      }
      clearTimer();
      mode.current =
        onSwipe && Math.abs(dx) > Math.abs(dy) && dx * direction > 0 ? "swipe" : "scroll";
    }

    if (mode.current === "swipe") {
      const next = Math.min(Math.max(dx * direction, 0), SWIPE_MAX);
      if (next >= SWIPE_TRIGGER && !armed.current) {
        armed.current = true;
        vibrate();
      } else if (next < SWIPE_TRIGGER) {
        armed.current = false;
      }
      setPull(next);
    }
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    clearTimer();
    if (mode.current === "pressed") {
      // the menu is open: no click on the bubble (image modal, link) and none on the backdrop
      event.preventDefault();
    } else if (mode.current === "swipe" && armed.current) {
      onSwipe?.();
    } else if (
      mode.current === "pending" &&
      !(event.target instanceof Element && event.target.closest("a, button, img, input"))
    ) {
      onTap?.();
    }
    mode.current = "idle";
    armed.current = false;
    setPull(0);
  };

  const onTouchCancel = () => {
    clearTimer();
    mode.current = "idle";
    armed.current = false;
    setPull(0);
  };

  // Android opens its own menu on a long press
  const onContextMenu = (event: React.MouseEvent) => {
    if (mode.current !== "idle") {
      event.preventDefault();
    }
  };

  return {
    pull,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu },
  };
};

export default useMessageGestures;
