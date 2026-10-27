// Runs synchronously in <head>, before application styles or rendering.
(() => {
  let language, theme;
  try {
    language = localStorage.getItem("bugradar.language");
    theme = localStorage.getItem("bugradar.theme");
  } catch {}
  language =
    language === "en" || language === "ar"
      ? language
      : (navigator.language || "en").toLowerCase().startsWith("ar")
        ? "ar"
        : "en";
  theme = theme === "dark" || theme === "light" ? theme : "system";
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
})();
