import { createHmac } from "crypto";

// Same STUN servers the call page always used.
const STUN_URLS = [
  "stun:openrelay.metered.ca:80",
  "stun:stun.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
];

const DEFAULT_TURN_TTL_SECONDS = 12 * 60 * 60;

// ICE servers for one user's call. When TURN_URLS and TURN_SECRET are set, adds a
// TURN server with short-lived credentials in the coturn `use-auth-secret` scheme
// (username = "<expiry unix time>:<userId>", credential = base64 HMAC-SHA1 of the
// username with the shared secret), so no static TURN password reaches browsers.
export const getIceServers = (userId: string): RTCIceServer[] => {
  const servers: RTCIceServer[] = [{ urls: STUN_URLS }];

  const turnUrls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const secret = process.env.TURN_SECRET;
  if (turnUrls.length === 0 || !secret) {
    return servers;
  }

  const ttl = Number(process.env.TURN_TTL_SECONDS) || DEFAULT_TURN_TTL_SECONDS;
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  servers.push({ urls: turnUrls, username, credential });

  return servers;
};
