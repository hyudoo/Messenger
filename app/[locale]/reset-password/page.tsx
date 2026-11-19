import { getTranslations } from "next-intl/server";

import AccountShell from "@/app/components/AccountShell";
import ResetPasswordForm, { ResetLinkInvalid } from "./ResetPasswordForm";

// A reset link (/reset-password?token=…) from the "forgot password" mail: a new password. The token
// is checked when it is sent (POST /api/password/reset), not here, so the page itself says nothing
// about whether a link is valid until it is used.
const ResetPasswordPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  const t = await getTranslations("reset");
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";

  return (
    <AccountShell back={{ href: "/", label: t("back") }}>
      {value ? <ResetPasswordForm token={value} /> : <ResetLinkInvalid />}
    </AccountShell>
  );
};

export default ResetPasswordPage;
