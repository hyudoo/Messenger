import { readFileSync } from "fs";

// Redis connection for the socket.io adapter and rate limiting. Either REDIS_URL (wins when set)
// or REDIS_HOST with optional:
// - REDIS_PORT (default 6379);
// - REDIS_USERNAME: an ACL user of its own (Redis 6+) instead of `default`;
// - REDIS_PASSWORD, or REDIS_PASSWORD_FILE: a file holding it (Docker / Kubernetes secrets, e.g.
//   /run/secrets/redis_password), so it needn't sit in the environment. The variable wins.
// Returns null when neither is set: everything stays in memory.

// the secret file is read once per path (rate limiting asks on every request)
const secretFiles = new Map<string, string>();
const readSecretFile = (path: string) => {
  let value = secretFiles.get(path);
  if (value === undefined) {
    try {
      // secret files usually end with a newline
      value = readFileSync(path, "utf8").replace(/\r?\n$/, "");
    } catch (error) {
      // fail loudly: the server stops at boot instead of connecting without the password
      throw new Error(`REDIS_PASSWORD_FILE can't be read (${(error as Error).message})`);
    }
    secretFiles.set(path, value);
  }
  return value;
};

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
  const passwordFile = process.env.REDIS_PASSWORD_FILE?.trim();
  const password =
    process.env.REDIS_PASSWORD || (passwordFile ? readSecretFile(passwordFile) : "");
  const username = process.env.REDIS_USERNAME?.trim() || "";
  // user name and password may contain @ : / #, which would break the URL unencoded
  const auth =
    username || password
      ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@`
      : "";
  return `redis://${auth}${host}:${port}`;
};
