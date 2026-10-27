// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, expect, vi } from "vitest";
import { Appearance } from "../src/Appearance";
import i18n from "../src/i18n";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("persists switches, reacts to OS changes only in system mode and retains nearby form state (DOM test)", async () => {
  let dark = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_event: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_event: string, fn: () => void) =>
      listeners.delete(fn),
  }));
  await i18n.changeLanguage("en");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <>
          <Appearance />
          <input defaultValue="draft project" />
        </>,
      );
    });
    const input = host.querySelector("input")!;
    input.value = "unfinished form";
    const [language, theme] = host.querySelectorAll("select");
    await act(async () => {
      language.value = "ar";
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem("bugradar.language")).toBe("ar");
    expect(input.value).toBe("unfinished form");
    await act(async () => {
      theme.value = "light";
      theme.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(localStorage.getItem("bugradar.theme")).toBe("light");
    await act(async () => {
      dark = true;
      listeners.forEach((f) => f());
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => {
      theme.value = "system";
      theme.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => {
      dark = false;
      listeners.forEach((f) => f());
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(input.value).toBe("unfinished form");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  expect(listeners.size).toBe(0);
});
