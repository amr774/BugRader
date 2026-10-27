import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  readPreference,
  resolveTheme,
  savePreference,
  type Theme,
} from "./preferences";
export function Appearance() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(readPreference("bugradar.theme")),
  );
  useEffect(() => {
    savePreference("bugradar.theme", theme);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <div className="appearance-controls">
      <label>
        {t("Language")}
        <select
          aria-label={t("Language")}
          value={i18n.language}
          onChange={(e) => void i18n.changeLanguage(e.target.value)}
        >
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </label>
      <label>
        {t("Theme")}
        <select
          aria-label={t("Theme")}
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="system">{t("System")}</option>
          <option value="dark">{t("Dark")}</option>
          <option value="light">{t("Light")}</option>
        </select>
      </label>
    </div>
  );
}
