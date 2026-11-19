import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import ForgotPasswordForm from "./ForgotPasswordForm";

// "Forgot password": the address to send a reset link to (public, like the login page).
const ForgotPasswordPage = async () => {
  const t = await getTranslations("forgot");
  return (
    <div className="flex min-h-full items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-background p-8 shadow">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">{t("intro")}</p>
        <ForgotPasswordForm />
        <Link href="/" className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
          {t("back")}
        </Link>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
