// Group invite links: /join/<code>. Shared by the routes, the join page and proxy.ts (which sends a
// signed-out visitor to the login page and back), so no Node-only imports here.

// 12 random bytes in base64url (crypto.randomBytes(12).toString("base64url"))
export const INVITE_CODE = /^[A-Za-z0-9_-]{16}$/;

export const isInviteCode = (value: unknown): value is string =>
  typeof value === "string" && INVITE_CODE.test(value);

// the path of the join page (without the locale)
export const invitePath = (code: string) => `/join/${code}`;

// Where the login page may send the user back to: only a join page, so `next` is no open redirect.
export const safeNextPath = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^\/join\/([^/?#]+)$/.exec(value);
  return match && isInviteCode(match[1]) ? value : null;
};
