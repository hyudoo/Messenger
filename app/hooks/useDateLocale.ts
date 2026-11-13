import { enUS, vi } from "date-fns/locale";
import { useLocale } from "next-intl";

// date-fns locale matching the UI language, for format(date, "p", { locale }).
const useDateLocale = () => (useLocale() === "vi" ? vi : enUS);

export default useDateLocale;
