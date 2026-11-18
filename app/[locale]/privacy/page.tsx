import { getTranslations } from "next-intl/server";

import LegalPage from "@/app/components/legal/LegalPage";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as "vi" | "en", namespace: "legal" });
  return { title: `${t("privacy.title")} | Messenger` };
}

export default function PrivacyPolicyPage() {
  return <LegalPage doc="privacy" />;
}
