// Password rules shared by the register form and /api/register.
// Returns the first broken rule as a code (shown through auth.password_rules.<code>),
// or null when the password is valid.
export type PasswordError =
  | "too_short"
  | "too_long"
  | "no_lowercase"
  | "no_uppercase"
  | "no_digit"
  | "no_special";

export const validatePassword = (password: unknown): PasswordError | null => {
  if (typeof password !== "string" || password.length < 8) {
    return "too_short";
  }
  if (password.length > 72) {
    // bcrypt ignores everything after 72 bytes
    return "too_long";
  }
  if (!/[a-z]/.test(password)) {
    return "no_lowercase";
  }
  if (!/[A-Z]/.test(password)) {
    return "no_uppercase";
  }
  if (!/\d/.test(password)) {
    return "no_digit";
  }
  if (!/[\W_]/.test(password)) {
    return "no_special";
  }
  return null;
};

// The same rules as a checklist, for showing them live under a "new password" field
// (auth.password_checks.<code>). validatePassword stays the source of truth.
export type PasswordCheck = "length" | "lowercase" | "uppercase" | "digit" | "special";

export const passwordChecks = (password: string): { code: PasswordCheck; ok: boolean }[] => [
  { code: "length", ok: password.length >= 8 && password.length <= 72 },
  { code: "lowercase", ok: /[a-z]/.test(password) },
  { code: "uppercase", ok: /[A-Z]/.test(password) },
  { code: "digit", ok: /\d/.test(password) },
  { code: "special", ok: /[\W_]/.test(password) },
];
