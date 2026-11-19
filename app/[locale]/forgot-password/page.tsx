import { getTranslations } from "next-intl/server";

import AccountShell from "@/app/components/AccountShell";
import { RESET_TTL_MS } from "@/app/libs/password-reset";
import ForgotPasswordForm from "./ForgotPasswordForm";

// "Forgot password": the address to send a reset link to (public, like the login page).
const ForgotPasswordPage = async () => {
  const t = await getTranslations("forgot");
  return (
    <AccountShell back={{ href: "/", label: t("back") }}>
      <ForgotPasswordForm minutes={Math.round(RESET_TTL_MS / 60_000)} />
    </AccountShell>
  );
};

export default ForgotPasswordPage;
