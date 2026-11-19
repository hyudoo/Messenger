import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import ResetPasswordForm from "./ResetPasswordForm";

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
    <div className="flex min-h-full items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-background p-8 shadow">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        {value ? (
          <>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">{t("intro")}</p>
            <ResetPasswordForm token={value} />
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("invalid")}</p>
        )}
        <Link
          href="/forgot-password"
          className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
          {t("new_link")}
        </Link>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
