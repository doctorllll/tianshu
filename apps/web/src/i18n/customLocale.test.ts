import { expect, it } from "vite-plus/test";
import { readCustomLocale, resolveAppLocale, syncCustomLocale } from "./customLocale";

it("uses Chinese for bare, regional, and script-specific Chinese locale IDs", () => {
  try {
    for (const locale of ["zh", "zh-CN", "zh-Hans", "zh-Hant-TW"]) {
      syncCustomLocale(locale);
      expect(readCustomLocale()).toBe("zh-CN");
    }
    syncCustomLocale("en-US");
    expect(readCustomLocale()).toBe("en");
  } finally {
    syncCustomLocale("en");
  }
});

it("chooses the primary system language for a new installation", () => {
  const supported = ["en", "zh", "fr"];
  expect(resolveAppLocale("system", "zh-CN", supported)).toBe("zh");
  expect(resolveAppLocale("system", "zh-Hant-TW", supported)).toBe("zh");
  expect(resolveAppLocale("system", "en-US", supported)).toBe("en");
  expect(resolveAppLocale("system", "fr-FR", supported)).toBe("en");
  expect(resolveAppLocale("fr", "zh-CN", supported)).toBe("fr");
  expect(resolveAppLocale("en", "zh-CN", supported)).toBe("en");
});
