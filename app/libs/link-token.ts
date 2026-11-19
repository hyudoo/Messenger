import { createHash, randomBytes } from "crypto";

// The random tokens of the links mailed to users ("forgot password", "verify your email"): 32
// random bytes in base64url. Only their SHA-256 is stored, so the database alone opens nothing.

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const newLinkToken = () => randomBytes(32).toString("base64url");

export const hashLinkToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const isLinkToken = (token: unknown): token is string =>
  typeof token === "string" && TOKEN.test(token);
