import { type Locale, appOrigin, mailLink } from "./account-mail";
import { VERIFY_TTL_MS, createVerificationToken } from "./email-verification";

// Mails the user a new verification link (their earlier ones stop working). The caller checks
// accountMailAvailable first.
export const sendVerificationMail = async (
  request: Request,
  user: { id: string; email: string; name: string | null },
  locale: Locale
) => {
  const token = await createVerificationToken(user.id);
  return mailLink({
    to: user.email,
    name: user.name,
    locale,
    namespace: "verify_mail",
    link: `${appOrigin(request)}/${locale}/verify-email?token=${token}`,
    values: { hours: Math.round(VERIFY_TTL_MS / 3_600_000) },
  });
};
