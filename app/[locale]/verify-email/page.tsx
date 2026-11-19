import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import VerifyEmailButton from "./VerifyEmailButton";

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
    <div className="flex min-h-full items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-background p-8 shadow">
        <h1 className="text-xl font-semibold text-foreground">{t("page_title")}</h1>
        {value ? (
          <VerifyEmailButton token={value} />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("invalid")}</p>
        )}
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
          {t("to_sign_in")}
        </Link>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
