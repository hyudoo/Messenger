// Password rules shared by the register form and /api/register.
// Returns the first broken rule as a message, or null when the password is valid.
export const validatePassword = (password: unknown): string | null => {
  if (typeof password !== "string" || password.length < 8) {
    return "Mật khẩu quá ngắn!";
  }
  if (password.length > 72) {
    // bcrypt ignores everything after 72 bytes
    return "Mật khẩu tối đa 72 ký tự!";
  }
  if (!/[a-z]/.test(password)) {
    return "Mật khẩu phải chứa ít nhất một chữ cái viết thường!";
  }
  if (!/[A-Z]/.test(password)) {
    return "Mật khẩu phải chứa ít nhất một chữ cái viết hoa";
  }
  if (!/\d/.test(password)) {
    return "Mật khẩu phải chứa ít nhất một số";
  }
  if (!/[\W_]/.test(password)) {
    return "Mật khẩu phải chứa ít nhất một ký tự đặc biệt";
  }
  return null;
};
