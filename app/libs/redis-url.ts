// Redis connection for the socket.io adapter and rate limiting. Either
// REDIS_URL (wins when set) or REDIS_HOST with optional REDIS_PORT (default 6379)
// and REDIS_PASSWORD. Returns null when neither is set: everything stays in memory.
export const getRedisUrl = (): string | null => {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    return url;
  }
  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    return null;
  }
  const port = process.env.REDIS_PORT?.trim() || "6379";
  const password = process.env.REDIS_PASSWORD;
  // the password may contain @ : / #, which would break the URL unencoded
  const auth = password ? `:${encodeURIComponent(password)}@` : "";
  return `redis://${auth}${host}:${port}`;
};
