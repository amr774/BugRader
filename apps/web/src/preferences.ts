export type Language = "en" | "ar";
export type Theme = "dark" | "light" | "system";
export function resolveLanguage(
  saved: string | null,
  browserLanguage: string,
): Language {
  return saved === "ar" || saved === "en"
    ? saved
    : browserLanguage.toLowerCase().startsWith("ar")
      ? "ar"
      : "en";
}
export function resolveTheme(saved: string | null): Theme {
  return saved === "light" || saved === "dark" ? saved : "system";
}
export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences still work for this session. */
  }
}
