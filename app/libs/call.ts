// How long a call rings: the callee's modal closes and the caller gives up
// ("no answer") after this long, so both sides stop at about the same time.
export const CALL_RING_TIMEOUT_MS = 45_000;

type DateLike = Date | string | null | undefined;

// Seconds between answer and hang-up of a call message (server/call-log.ts), or null when the call
// was never answered or hasn't ended. Dates arrive as ISO strings over socket.io.
export const callDurationSeconds = (call: {
  callAnsweredAt?: DateLike;
  callEndedAt?: DateLike;
}): number | null => {
  if (!call.callAnsweredAt || !call.callEndedAt) {
    return null;
  }
  const ms = new Date(call.callEndedAt).getTime() - new Date(call.callAnsweredAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
};

// 0:07, 3:25, 1:02:09 (like a phone's call log)
export const formatCallDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
