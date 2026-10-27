import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolveLanguage, resolveTheme } from "../src/preferences";
import en from "../src/locales/en.json";
import ar from "../src/locales/ar.json";
describe("appearance preference initialization (not a browser visual test)", () => {
  it("saved language wins, Arabic browser locale is recognized and others fall back to English", () => {
    expect(resolveLanguage("en", "ar-EG")).toBe("en");
    expect(resolveLanguage("ar", "en-US")).toBe("ar");
    expect(resolveLanguage(null, "ar-SA")).toBe("ar");
    expect(resolveLanguage("invalid", "fr-FR")).toBe("en");
  });
  it("saved light/dark honored and missing/invalid theme follows system", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme(null)).toBe("system");
    expect(resolveTheme("invalid")).toBe("system");
  });
  it.each([
    ["ar", "light", true, "ar", "rtl", "light"],
    ["en", "dark", false, "en", "ltr", "dark"],
    [null, "system", true, "ar", "rtl", "dark"],
    [null, null, false, "ar", "rtl", "light"],
  ])(
    "applies %s/%s before React loads",
    (language, theme, dark, expectedLanguage, dir, expectedTheme) => {
      const document = {
        documentElement: {
          dataset: {} as Record<string, string>,
          lang: "",
          dir: "",
        },
      };
      runInNewContext(readFileSync("apps/web/public/appearance.js", "utf8"), {
        document,
        navigator: { language: "ar-EG" },
        localStorage: {
          getItem: (key: string) =>
            key.endsWith("language") ? language : theme,
        },
        matchMedia: () => ({ matches: dark }),
      });
      expect(document.documentElement.lang).toBe(expectedLanguage);
      expect(document.documentElement.dir).toBe(dir);
      expect(document.documentElement.dataset.theme).toBe(expectedTheme);
    },
  );
  it("blocked storage still initializes language and system appearance", () => {
    const document = {
      documentElement: {
        dataset: {} as Record<string, string>,
        lang: "",
        dir: "",
      },
    };
    runInNewContext(readFileSync("apps/web/public/appearance.js", "utf8"), {
      document,
      navigator: { language: "fr" },
      localStorage: {
        getItem: () => {
          throw Error("blocked");
        },
      },
      matchMedia: () => ({ matches: false }),
    });
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("Arabic and English catalogs have identical, nonempty keys", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(ar).every((v) => v.trim().length > 0)).toBe(true);
  });
});
