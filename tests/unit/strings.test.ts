import { describe, expect, it } from "vitest";
import { STRINGS_EN, resolveStrings, type WidgetStrings } from "../../src/strings.js";

/**
 * The public widget renders nothing but the copy in `STRINGS_EN` (Stage 0).
 * These tests pin the catalog's shape so a locale that omits a key, changes a
 * value's type, or ships a garbled character fails here instead of on a page.
 */

const SCALAR_KEYS: Array<keyof WidgetStrings> = [
  "fabLabel",
  "panelTitle",
  "avatarGlyph",
  "closeLabel",
  "closeAriaLabel",
  "statusOpen",
  "statusClosed",
  "statusClosedNext",
  "statusIdle",
  "presetsAriaLabel",
  "messageLabel",
  "messagePlaceholder",
  "sendLabel",
  "daysMonFri",
  "daysMonSat",
  "daysEvery",
  "catalogLabel",
  "departmentsAriaLabel",
  "leadNameLabel",
  "leadInterestLabel",
  "leadContinueLabel",
  "leadNameInvalid",
  "leadConsentRequired",
  "nudgeDefault",
  "nudgeCloseLabel",
  "tooltipSeparator",
  "tooltipRange",
];

describe("STRINGS_EN", () => {
  it("has non-empty text for every scalar key", () => {
    for (const key of SCALAR_KEYS) {
      expect(typeof STRINGS_EN[key]).toBe("string");
      expect((STRINGS_EN[key] as string).length).toBeGreaterThan(0);
    }
  });

  it("pins the glyphs the mojibake bug once mangled", () => {
    expect(STRINGS_EN.avatarGlyph).toBe("💬");
    expect(STRINGS_EN.closeLabel).toBe("×");
    expect(STRINGS_EN.messagePlaceholder).toBe("Type a message…");
    expect(STRINGS_EN.statusClosed).toBe("Closed — messages welcome");
    expect(STRINGS_EN.statusClosedNext).toBe("Closed — opens {next}");
    expect(STRINGS_EN.daysMonFri).toBe("Mon–Fri");
    expect(STRINGS_EN.nudgeDefault).toBe("👋 Need help? We're here to chat.");
    expect(STRINGS_EN.tooltipSeparator).toBe(" · ");
    expect(STRINGS_EN.tooltipRange).toBe("–");
  });

  it("carries exactly seven unique day names in JavaScript order", () => {
    expect(STRINGS_EN.dayNames).toHaveLength(7);
    expect(new Set(STRINGS_EN.dayNames).size).toBe(7);
    expect(STRINGS_EN.dayNames.every((name) => name.length > 0)).toBe(true);
    expect(STRINGS_EN.dayNames[0]).toBe("Sun");
    expect(STRINGS_EN.dayNames[6]).toBe("Sat");
  });

  it("contains no mojibake signatures", () => {
    const signatures = [
      "\u00E2\u20AC",
      "\u00E2\u2020",
      "\u00E2\u201D\u20AC",
      "\u00C3\u2014",
      "\u00F0\u0178",
      "\u00C2\u00B7",
      "\uFFFD",
    ];
    const joined = Object.values(STRINGS_EN)
      .flat()
      .join(" ");
    for (const signature of signatures) {
      expect(joined).not.toContain(signature);
    }
  });
});

describe("resolveStrings", () => {
  it("resolves English with the canonical table in Stage 0", () => {
    expect(resolveStrings("", "", "")).toEqual({ locale: "en", values: STRINGS_EN });
  });

  it("prefers the explicit setting, then the browser, then the page locale", () => {
    // Only English is shipped today, so every chain ends there — but the
    // order is what matters: an explicit invalid locale must not shadow the
    // rest of the chain.
    expect(resolveStrings("fr", "", "en")).toEqual({ locale: "en", values: STRINGS_EN });
    expect(resolveStrings("en", "fr", "de")).toEqual({ locale: "en", values: STRINGS_EN });
    expect(resolveStrings("", "fr-FR", "")).toEqual({ locale: "en", values: STRINGS_EN });
  });

  it("treats auto as the browser language", () => {
    expect(resolveStrings("auto", "en-US", "de")).toEqual({ locale: "en", values: STRINGS_EN });
    expect(resolveStrings("auto", "fr", "")).toEqual({ locale: "en", values: STRINGS_EN });
  });

  it("normalizes underscores and case in language tags", () => {
    expect(resolveStrings("EN_us", "", "")).toEqual({ locale: "en", values: STRINGS_EN });
  });
});
