import { getTranslations } from "next-intl/server";

import AccountShell from "@/app/components/AccountShell";
import VerifyEmailButton, { VerifyLinkInvalid } from "./VerifyEmailButton";

// A link from the "verify your email" mail (/verify-email?token=…). The token is used by a click
// (POST /api/email/verify), not by opening the page, so mail scanners that fetch links don't
// spend it; the page says nothing about a link until then.
const VerifyEmailPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  const t = await getTranslations("verify");
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";

  return (
    <AccountShell back={{ href: "/", label: t("to_sign_in") }}>
      {value ? <VerifyEmailButton token={value} /> : <VerifyLinkInvalid />}
    </AccountShell>
  );
};

export default VerifyEmailPage;
