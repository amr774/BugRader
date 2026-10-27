import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import { readPreference, resolveLanguage, savePreference } from "./preferences";
void i18next
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    lng: resolveLanguage(
      readPreference("bugradar.language"),
      navigator.language ?? "en",
    ),
    fallbackLng: "en",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
function applyLanguage(language: string) {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  savePreference("bugradar.language", language);
}
i18next.on("languageChanged", applyLanguage);
applyLanguage(i18next.language);
export const t = (key: string, options?: Record<string, unknown>) =>
  String(i18next.t(key, options ?? {}));
export const locale = () => (i18next.language === "ar" ? "ar-EG" : "en-US");
export default i18next;
