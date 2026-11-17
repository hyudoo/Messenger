"use client";

import { useEffect } from "react";

export type CallTone = "ringtone" | "ringback";

interface Note {
  at: number; // seconds from the start of the cycle
  dur: number; // seconds
  freqs: number[]; // played together
}

interface Pattern {
  notes: Note[];
  period: number; // seconds between cycles
  gain: number;
}

const PATTERNS: Record<CallTone, Pattern> = {
  // incoming call: two rising double chimes, every 3 s
  ringtone: {
    notes: [
      { at: 0, dur: 0.16, freqs: [880] },
      { at: 0.2, dur: 0.22, freqs: [1175] },
      { at: 0.6, dur: 0.16, freqs: [880] },
      { at: 0.8, dur: 0.22, freqs: [1175] },
    ],
    period: 3,
    gain: 0.18,
  },
  // caller waiting for an answer: 425 Hz, 1 s on / 4 s off (VN / EU ringback)
  ringback: {
    notes: [{ at: 0, dur: 1, freqs: [425] }],
    period: 5,
    gain: 0.12,
  },
};

const RAMP = 0.02; // fade in / out, avoids clicks

/**
 * Plays a synthesized call tone in a loop while `active` is true.
 * Browsers start an AudioContext suspended without a user gesture; in that case
 * the tone starts on the next click / key press.
 */
const useCallTone = (tone: CallTone, active: boolean) => {
  useEffect(() => {
    if (!active || typeof window === "undefined") {
      return;
    }
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    const pattern = PATTERNS[tone];
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = pattern.gain;
    master.connect(ctx.destination);

    const playCycle = () => {
      const t0 = ctx.currentTime + 0.05;
      for (const note of pattern.notes) {
        const start = t0 + note.at;
        const end = start + note.dur;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(1, start + RAMP);
        env.gain.setValueAtTime(1, end - RAMP);
        env.gain.linearRampToValueAtTime(0, end);
        env.connect(master);
        for (const freq of note.freqs) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = freq;
          osc.connect(env);
          osc.start(start);
          osc.stop(end);
        }
      }
    };

    let timer: ReturnType<typeof setInterval> | undefined;
    const startLoop = () => {
      if (timer !== undefined || ctx.state !== "running") {
        return;
      }
      playCycle();
      timer = setInterval(playCycle, pattern.period * 1000);
    };

    const unlock = () => {
      ctx.resume().catch(() => {});
    };
    ctx.onstatechange = startLoop;
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    unlock();
    startLoop();

    return () => {
      clearInterval(timer);
      ctx.onstatechange = null;
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      ctx.close().catch(() => {});
    };
  }, [tone, active]);
};

export default useCallTone;
