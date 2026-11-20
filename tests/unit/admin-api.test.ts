import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_SETTING_KEYS,
  SETTING_DEFAULTS,
  buildAdminSettings,
  validateAdminSettingsUpdate,
} from "../../src/admin-api.js";
import { DAY_SETS } from "../../src/settings.js";

/**
 * The admin screen saves through the plugin's own `PUT admin-settings` route,
 * so every rule that gate applies has to hold here: defaults match the
 * manifest, unknown keys are ignored, and each known key accepts exactly the
 * values the widget can actually use.
 */

const packageRoot = path.dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

function manifestSchema(): Record<string, { default?: unknown }> {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "justflows.json"), "utf8")) as {
    settingsSchema: Record<string, { default?: unknown }>;
  };
  return manifest.settingsSchema;
}

describe("admin settings defaults", () => {
  it("match the manifest schema defaults key for key", () => {
    const schema = manifestSchema();
    expect(Object.keys(schema).sort()).toEqual([...ADMIN_SETTING_KEYS].sort());
    for (const key of ADMIN_SETTING_KEYS) {
      expect(SETTING_DEFAULTS[key]).toEqual(schema[key]?.default);
    }
  });
});

describe("buildAdminSettings", () => {
  it("fills every key from the defaults when nothing is stored", () => {
    const built = buildAdminSettings({});
    expect(Object.keys(built).sort()).toEqual([...ADMIN_SETTING_KEYS].sort());
    expect(built.enabled).toBe(true);
    expect(built.whatsappNumber).toBe("");
    expect(built.buttonPosition).toBe("bottom-right");
    expect(built.buttonSize).toBe("medium");
    expect(built.buttonColor).toBe("#25d366");
    expect(built.businessDays).toBe("weekdays");
    expect(built.businessOpenTime).toBe("09:00");
    expect(built.businessCloseTime).toBe("17:00");
    expect(built.analyticsEnabled).toBe(true);
    expect(built.presetMessages).toContain("I'd like a quote");
  });

  it("resolves stored values into schema-shaped output", () => {
    const built = buildAdminSettings({
      enabled: false,
      buttonPosition: "bottom-left",
      buttonSize: "large",
      buttonColor: "#FF8800",
      businessDays: "daily",
      businessOpenTime: "22:00",
      businessCloseTime: "o'clock",
    });
    expect(built.enabled).toBe(false);
    expect(built.buttonPosition).toBe("bottom-left");
    expect(built.buttonSize).toBe("large");
    expect(built.buttonColor).toBe("#ff8800");
    expect(built.businessDays).toBe("daily");
    expect(built.businessOpenTime).toBe("22:00");
    expect(built.businessCloseTime).toBe("17:00");
  });
});

describe("validateAdminSettingsUpdate", () => {
  it("accepts a full valid save and keeps only what was sent", () => {
    const checked = validateAdminSettingsUpdate({
      enabled: true,
      whatsappNumber: "+233 20 123 4567",
      welcomeMessage: "Hello there",
      presetMessages: "A\nB",
      buttonPosition: "bottom-left",
      buttonColor: "#4F46E5",
      buttonSize: "large",
      businessHoursEnabled: true,
      businessOpenTime: "09:30",
      businessCloseTime: "17:15",
      businessDays: "mon-sat",
      businessTimezone: "Africa/Accra",
      analyticsEnabled: false,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(Object.keys(checked.values).length).toBe(ADMIN_SETTING_KEYS.length);
    expect(checked.values.whatsappNumber).toBe("+233 20 123 4567");
    expect(checked.values.buttonColor).toBe("#4f46e5");
  });

  it("ignores unknown keys instead of rejecting the save", () => {
    const checked = validateAdminSettingsUpdate({ enabled: false, maliciousKey: "<script>" });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.values).toEqual({ enabled: false });
  });

  it("accepts an empty object as a no-op", () => {
    const checked = validateAdminSettingsUpdate({});
    expect(checked).toEqual({ ok: true, values: {} });
  });

  it("rejects a body that is not a settings object", () => {
    for (const body of [null, "settings", 42, []]) {
      const checked = validateAdminSettingsUpdate(body);
      expect(checked.ok).toBe(false);
    }
  });

  it("requires real booleans for the toggles", () => {
    for (const key of ["enabled", "businessHoursEnabled", "analyticsEnabled"] as const) {
      expect(validateAdminSettingsUpdate({ [key]: "true" }).ok).toBe(false);
      expect(validateAdminSettingsUpdate({ [key]: 1 }).ok).toBe(false);
      const checked = validateAdminSettingsUpdate({ [key]: false });
      expect(checked.ok).toBe(true);
      if (checked.ok) expect(checked.values[key]).toBe(false);
    }
  });

  it("accepts an empty number but refuses a non-numeric one", () => {
    expect(validateAdminSettingsUpdate({ whatsappNumber: "" }).ok).toBe(true);
    for (const bad of ["call me", "#555", "12345678901234567890"]) {
      const checked = validateAdminSettingsUpdate({ whatsappNumber: bad });
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.field).toBe("whatsappNumber");
    }
    expect(validateAdminSettingsUpdate({ whatsappNumber: "+233201234567" }).ok).toBe(true);
  });

  it("bounds the text areas", () => {
    expect(validateAdminSettingsUpdate({ welcomeMessage: "x".repeat(501) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ presetMessages: "a\nb\nc\nd\ne\nf\ng" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ presetMessages: "x".repeat(201) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ presetMessages: "one\ntwo" }).ok).toBe(true);
  });

  it("keeps the select fields to their declared choices", () => {
    expect(validateAdminSettingsUpdate({ buttonPosition: "top-right" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ buttonSize: "huge" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ buttonSize: "small" }).ok).toBe(true);
    for (const key of Object.keys(DAY_SETS)) {
      const checked = validateAdminSettingsUpdate({ businessDays: key });
      expect(checked.ok).toBe(true);
    }
    expect(validateAdminSettingsUpdate({ businessDays: "sundays" }).ok).toBe(false);
  });

  it("accepts only hex colours, lowercased, or empty", () => {
    expect(validateAdminSettingsUpdate({ buttonColor: "#25D366" })).toEqual({
      ok: true,
      values: { buttonColor: "#25d366" },
    });
    expect(validateAdminSettingsUpdate({ buttonColor: "" }).ok).toBe(true);
    for (const bad of ["green", "25d366", "#12345", "javascript:void(0)"]) {
      expect(validateAdminSettingsUpdate({ buttonColor: bad }).ok).toBe(false);
    }
  });

  it("checks the clocks and the time zone", () => {
    expect(validateAdminSettingsUpdate({ businessOpenTime: "09:00" }).ok).toBe(true);
    for (const bad of ["9:00", "24:00", "09:60", "morning"]) {
      expect(validateAdminSettingsUpdate({ businessOpenTime: bad }).ok).toBe(false);
      expect(validateAdminSettingsUpdate({ businessCloseTime: bad }).ok).toBe(false);
    }
    expect(validateAdminSettingsUpdate({ businessTimezone: "" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ businessTimezone: "Africa/Accra" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ businessTimezone: "../etc/passwd" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ businessTimezone: "x".repeat(65) }).ok).toBe(false);
  });
});
