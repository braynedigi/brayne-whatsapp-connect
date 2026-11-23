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
    expect(built.schedule).toBe('[{"days":[1,2,3,4,5],"open":"09:00","close":"17:00"}]');
    expect(built.holidays).toBe("[]");
    expect(built.openLabel).toBe("");
    expect(built.closedLabel).toBe("");
    expect(built.closedExtra).toBe("");
    expect(built.openColor).toBe("");
    expect(built.closedColor).toBe("");
    expect(built.departments).toBe("[]");
    expect(built.catalogUrl).toBe("");
    expect(built.leadFormEnabled).toBe(false);
    expect(built.leadInterests).toBe("");
    expect(built.leadConsentText).toBe(
      "I agree that my name and message will be sent to this business over WhatsApp.",
    );
    expect(built.analyticsEnabled).toBe(true);
    expect(built.analyticsPages).toBe(false);
    expect(built.nudgeEnabled).toBe(false);
    expect(built.nudgeDelaySeconds).toBe("15");
    expect(built.nudgeText).toBe("👋 Need help? We're here to chat.");
    expect(built.nudgeMode).toBe("once-per-load");
    expect(built.presetMessages).toContain("I'd like a quote");
    expect(built.welcomeMessageOpen).toBe("Hi! I'd like to know more about your services.");
    expect(built.welcomeMessageClosed).toBe("Hi! I'd like to know more about your services.");
    expect(built.widgetLanguage).toBe("");
    expect(built.pageRules).toBe("");
    expect(built.agentName).toBe("");
    expect(built.agentRole).toBe("");
    expect(built.agentPhoto).toBe("");
    expect(built.utmPropagation).toBe(false);
  });

  it("migrates the legacy welcome message into both greeting fields", () => {
    const built = buildAdminSettings({ welcomeMessage: "Legacy hello!" });
    expect(built.welcomeMessageOpen).toBe("Legacy hello!");
    expect(built.welcomeMessageClosed).toBe("Legacy hello!");
  });

  it("migrates the legacy hour keys into the schedule field", () => {
    const built = buildAdminSettings({
      businessDays: "mon-sat",
      businessOpenTime: "08:30",
      businessCloseTime: "18:00",
    });
    expect(built.schedule).toBe('[{"days":[1,2,3,4,5,6],"open":"08:30","close":"18:00"}]');
  });

  it("keeps a stored schedule exactly as saved", () => {
    const stored = '[{"days":[0,6],"open":"11:00","close":"15:00"}]';
    const built = buildAdminSettings({ schedule: stored });
    expect(built.schedule).toBe(stored);
  });

  it("resolves stored values into schema-shaped output", () => {
    const built = buildAdminSettings({
      enabled: false,
      buttonPosition: "bottom-left",
      buttonSize: "large",
      buttonColor: "#FF8800",
      openColor: "#12A150",
      closedLabel: "  Away  ",
    });
    expect(built.enabled).toBe(false);
    expect(built.buttonPosition).toBe("bottom-left");
    expect(built.buttonSize).toBe("large");
    expect(built.buttonColor).toBe("#ff8800");
    expect(built.openColor).toBe("#12a150");
    expect(built.closedLabel).toBe("Away");
    expect(built.schedule).toBe('[{"days":[1,2,3,4,5],"open":"09:00","close":"17:00"}]');
  });
});

describe("validateAdminSettingsUpdate", () => {
  it("accepts a full valid save and keeps only what was sent", () => {
    const checked = validateAdminSettingsUpdate({
      enabled: true,
      whatsappNumber: "+233 20 123 4567",
      welcomeMessageOpen: "Hello there",
      welcomeMessageClosed: "We are closed now",
      presetMessages: "A\nB",
      buttonPosition: "bottom-left",
      buttonColor: "#4F46E5",
      buttonSize: "large",
      businessHoursEnabled: true,
      schedule:
        '[{"days":[1,2,3,4,5],"open":"09:30","close":"17:15"},{"days":[6],"open":"10:00","close":"14:00"}]',
      holidays: '[{"date":"2026-12-25","label":"Christmas Day"}]',
      businessTimezone: "Africa/Accra",
      openLabel: "Open now!",
      closedLabel: "Away",
      closedExtra: "We reply when we reopen.",
      openColor: "#12A150",
      closedColor: "#B45309",
      departments:
        '[{"name": "Sales", "number": "+233 20 123 4567", "icon": "💼"}, {"name": "Support", "number": "15551234567"}]',
      catalogUrl: "https://wa.me/c/15551234567",
      leadFormEnabled: true,
      leadInterests: "A quote\nSupport",
      leadConsentText: "I agree to be contacted.",
      analyticsEnabled: false,
      analyticsPages: true,
      nudgeEnabled: true,
      nudgeDelaySeconds: "20",
      nudgeText: "Chat with us!",
      nudgeMode: "once-per-day",
      widgetLanguage: "auto",
      pageRules:
        '[{"pattern": "/pricing", "welcome": "Want a quote?", "presets": ["Send pricing"]}]',
      agentName: "Ama Mensah",
      agentRole: "Sales",
      agentPhoto: "/media/team/ama.png",
      utmPropagation: true,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(Object.keys(checked.values).length).toBe(ADMIN_SETTING_KEYS.length);
    expect(checked.values.whatsappNumber).toBe("+233 20 123 4567");
    expect(checked.values.buttonColor).toBe("#4f46e5");
    expect(checked.values.agentName).toBe("Ama Mensah");
    expect(checked.values.utmPropagation).toBe(true);
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
    for (const key of [
      "enabled",
      "businessHoursEnabled",
      "analyticsEnabled",
      "analyticsPages",
      "utmPropagation",
    ] as const) {
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
    expect(validateAdminSettingsUpdate({ welcomeMessageOpen: "x".repeat(501) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ welcomeMessageClosed: "x".repeat(501) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ presetMessages: "a\nb\nc\nd\ne\nf\ng" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ presetMessages: "x".repeat(201) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ presetMessages: "one\ntwo" }).ok).toBe(true);
  });

  it("keeps the widget language to the shipped locales", () => {
    expect(validateAdminSettingsUpdate({ widgetLanguage: "" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ widgetLanguage: "auto" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ widgetLanguage: "en" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ widgetLanguage: "fr" }).ok).toBe(false);
  });

  it("validates page rules as a bounded JSON array", () => {
    expect(validateAdminSettingsUpdate({ pageRules: "" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ pageRules: "not json" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ pageRules: '{"a":1}' }).ok).toBe(false);
    expect(
      validateAdminSettingsUpdate({
        pageRules: '[{"pattern": "no-slash", "welcome": "Bad"}]',
      }).ok,
    ).toBe(false);
    expect(
      validateAdminSettingsUpdate({
        pageRules: '[{"pattern": "/ok", "presets": ["a".repeat(201)]}]',
      }).ok,
    ).toBe(false);
    const checked = validateAdminSettingsUpdate({
      pageRules: '[{"pattern": "/pricing", "welcome": "Want a quote?"}]',
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.values.pageRules).toContain("/pricing");
  });

  it("validates the agent fields", () => {
    expect(validateAdminSettingsUpdate({ agentName: "Ama" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ agentName: "x".repeat(61) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ agentRole: "x".repeat(61) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ agentPhoto: "/media/team/ama.png" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ agentPhoto: "https://cdn.example.com/a.png" }).ok).toBe(
      true,
    );
    for (const bad of ["javascript:alert(1)", "http://x.com/a.png", '" onerror="x']) {
      expect(validateAdminSettingsUpdate({ agentPhoto: bad }).ok).toBe(false);
    }
  });

  it("keeps the select fields to their declared choices", () => {
    expect(validateAdminSettingsUpdate({ buttonPosition: "top-right" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ buttonSize: "huge" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ buttonSize: "small" }).ok).toBe(true);
  });

  it("validates the schedule as a bounded JSON array of windows", () => {
    expect(validateAdminSettingsUpdate({ schedule: "[]" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ schedule: "not json" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ schedule: '{"days":[]}' }).ok).toBe(false);
    expect(
      validateAdminSettingsUpdate({
        schedule: '[{"days":[1,1,2],"open":"09:00","close":"17:00"}]',
      }).ok,
    ).toBe(false);
    expect(
      validateAdminSettingsUpdate({ schedule: '[{"days":[],"open":"09:00","close":"17:00"}]' }).ok,
    ).toBe(false);
    expect(
      validateAdminSettingsUpdate({
        schedule: '[{"days":[1,2],"open":"9:00","close":"17:00"}]',
      }).ok,
    ).toBe(false);
    const checked = validateAdminSettingsUpdate({
      schedule: '[{"days":[0,6],"open":"11:00","close":"15:00"}]',
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.values.schedule).toContain('"days":[0,6]');
  });

  it("validates holidays as a bounded JSON array", () => {
    expect(validateAdminSettingsUpdate({ holidays: "[]" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ holidays: "not json" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ holidays: '[{"date":"25-12-2026"}]' }).ok).toBe(false);
    expect(
      validateAdminSettingsUpdate({ holidays: '[{"from":"2026-12-28","to":"2026-12-25"}]' }).ok,
    ).toBe(false);
    expect(
      validateAdminSettingsUpdate({ holidays: '[{"from":"2026-12-20","to":"2026-12-31","label":"Break"}]' })
        .ok,
    ).toBe(true);
    expect(
      validateAdminSettingsUpdate({
        holidays: '[{"date":"2026-12-25","label":"x".repeat(61)}]',
      }).ok,
    ).toBe(false);
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

  it("bounds the badge labels and validates the badge colours", () => {
    expect(validateAdminSettingsUpdate({ openLabel: "x".repeat(61) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ closedLabel: "x".repeat(61) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ closedExtra: "x".repeat(121) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ openLabel: "Open!" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ openColor: "#12A150" })).toEqual({
      ok: true,
      values: { openColor: "#12a150" },
    });
    expect(validateAdminSettingsUpdate({ closedColor: "" }).ok).toBe(true);
    for (const bad of ["green", "12a150", "url(x)"]) {
      expect(validateAdminSettingsUpdate({ openColor: bad }).ok).toBe(false);
      expect(validateAdminSettingsUpdate({ closedColor: bad }).ok).toBe(false);
    }
  });

  it("validates the nudge settings with the annoyance floor", () => {
    expect(validateAdminSettingsUpdate({ nudgeEnabled: true }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ nudgeEnabled: "yes" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ nudgeDelaySeconds: "20" }).ok).toBe(true);
    for (const bad of ["4", "301", "12.5", "soon"]) {
      expect(validateAdminSettingsUpdate({ nudgeDelaySeconds: bad }).ok).toBe(false);
    }
    expect(validateAdminSettingsUpdate({ nudgeText: "x".repeat(121) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ nudgeMode: "always" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ nudgeMode: "once-per-day" }).ok).toBe(true);
  });

  it("checks the time zone", () => {
    expect(validateAdminSettingsUpdate({ businessTimezone: "" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ businessTimezone: "Africa/Accra" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ businessTimezone: "../etc/passwd" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ businessTimezone: "x".repeat(65) }).ok).toBe(false);
  });

  it("validates departments as a bounded JSON array", () => {
    expect(validateAdminSettingsUpdate({ departments: "[]" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ departments: "not json" }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ departments: '{"a":1}' }).ok).toBe(false);
    expect(
      validateAdminSettingsUpdate({
        departments: '[{"name":"Sales","number":"call me"}]',
      }).ok,
    ).toBe(false);
    expect(
      validateAdminSettingsUpdate({ departments: '[{"name":"","number":"15551234567"}]' }).ok,
    ).toBe(false);
    const checked = validateAdminSettingsUpdate({
      departments: '[{"name":"Sales","number":"+233 20 123 4567","icon":"💼"}]',
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.values.departments).toContain("Sales");
  });

  it("validates the catalog link allow-list", () => {
    expect(validateAdminSettingsUpdate({ catalogUrl: "" }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ catalogUrl: "https://wa.me/c/15551234567" }).ok).toBe(
      true,
    );
    for (const bad of ["https://wa.me/15551234567", "https://evil.example/c/", "javascript:x"]) {
      expect(validateAdminSettingsUpdate({ catalogUrl: bad }).ok).toBe(false);
    }
  });

  it("validates the lead form fields and their cross-rules", () => {
    expect(validateAdminSettingsUpdate({ leadFormEnabled: true }).ok).toBe(true);
    expect(validateAdminSettingsUpdate({ leadFormEnabled: "yes" }).ok).toBe(false);
    expect(
      validateAdminSettingsUpdate({ leadInterests: "a\nb\nc\nd\ne\nf\ng\nh\ni" }).ok,
    ).toBe(false);
    expect(validateAdminSettingsUpdate({ leadInterests: "x".repeat(61) }).ok).toBe(false);
    expect(validateAdminSettingsUpdate({ leadConsentText: "x".repeat(301) }).ok).toBe(false);
    // Turning the form on while explicitly clearing the consent line is refused.
    expect(
      validateAdminSettingsUpdate({ leadFormEnabled: true, leadConsentText: "  " }).ok,
    ).toBe(false);
    expect(
      validateAdminSettingsUpdate({ leadFormEnabled: true, leadConsentText: "I agree." }).ok,
    ).toBe(true);
  });
});
