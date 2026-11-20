import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { deepStrictEqual } from "node:assert";
import { describe, expect, it } from "vitest";
import { PLUGIN_ID_RE, PluginManifestSchema } from "@justflows/sdk";
import plugin from "../../src/index.js";

/**
 * `justflows.json` is what the host reads to discover, list and describe the
 * plugin; `src/index.ts` is what the loader validates on activation. If the two
 * drift, the admin shows one thing and the runtime behaves as another — so they
 * are compared field by field rather than trusted to stay in step by hand.
 */

const packageRoot = path.dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

type SettingsField = {
  type: string;
  options?: Array<{ value: string; label: string }>;
  optionsSource?: string;
  default?: unknown;
};

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(packageRoot, file), "utf8")) as Record<string, unknown>;
}

const fileManifest = readJson("justflows.json");
const moduleManifest = plugin.manifest as unknown as Record<string, unknown>;

/** Fields both copies must agree on. `publisher` / `schemaVersion` / `type` are file-only. */
const SHARED_FIELDS = [
  "id",
  "apiNamespace",
  "name",
  "version",
  "license",
  "description",
  "engines",
  "permissions",
  "main",
  "registry",
  "settingsSchema",
  "adminSection",
  "adminMenu",
  "adminApp",
  "assets",
] as const;

const SETTINGS_KEYS = [
  "enabled",
  "whatsappNumber",
  "welcomeMessage",
  "presetMessages",
  "buttonPosition",
  "buttonColor",
  "buttonSize",
  "businessHoursEnabled",
  "businessOpenTime",
  "businessCloseTime",
  "businessDays",
  "businessTimezone",
  "analyticsEnabled",
];

describe("manifest", () => {
  it("declares a first-party plugin id", () => {
    expect(typeof fileManifest["id"]).toBe("string");
    expect(PLUGIN_ID_RE.test(String(fileManifest["id"]))).toBe(true);
  });

  it("pins a supported Justflows range", () => {
    expect(fileManifest["engines"]).toEqual({ justflows: ">=0.4.0 <0.5.0" });
  });

  it("uses a GPL-compatible license", () => {
    expect(fileManifest["license"]).toBe("GPL-2.0-or-later");
    expect(plugin.manifest.license).toBe("GPL-2.0-or-later");
  });

  it("keeps justflows.json and the module manifest identical", () => {
    const drifted: string[] = [];
    for (const field of SHARED_FIELDS) {
      try {
        deepStrictEqual(moduleManifest[field], fileManifest[field]);
      } catch {
        drifted.push(field);
      }
    }
    expect(drifted).toEqual([]);
  });

  it("satisfies the SDK schema the loader applies on activation", () => {
    const parsed = PluginManifestSchema.safeParse(moduleManifest);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.success).toBe(true);
  });

  it("satisfies the SDK schema when read from justflows.json", () => {
    const parsed = PluginManifestSchema.safeParse(fileManifest);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.success).toBe(true);
  });

  it("asks for admin:extend because it contributes an admin menu", () => {
    expect(plugin.manifest.permissions).toContain("admin:extend");
    expect(plugin.manifest.adminMenu?.[0]?.domain).toBe("plugin");
    expect(plugin.manifest.adminSection?.label).toBe("WhatsApp Connect");
  });

  it("declares an admin app whose build files exist", () => {
    const adminApp = plugin.manifest.adminApp;
    expect(adminApp?.dir).toBe("admin");
    expect(adminApp?.routes.length).toBeGreaterThan(0);
    expect(adminApp?.routes[0]?.path).toBe("");
    expect(adminApp?.routes[0]?.entry).toBe("index.html");
    /** The SDK schema requires an English catalog for every admin app. */
    expect(adminApp?.locales?.["en"]).toBe("locales/en.json");
    for (const rel of [
      "admin/index.html",
      "admin/app.js",
      "admin/app.css",
      "admin/locales/en.json",
    ]) {
      expect(existsSync(path.join(packageRoot, rel))).toBe(true);
    }
  });

  it("keeps the admin catalog a flat, non-empty string map", () => {
    const catalog = JSON.parse(
      readFileSync(path.join(packageRoot, "admin/locales/en.json"), "utf8"),
    ) as Record<string, unknown>;
    const entries = Object.entries(catalog);
    expect(entries.length).toBeGreaterThan(40);
    for (const [key, value] of entries) {
      expect(key.length).toBeGreaterThan(0);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it("uses an API namespace the host does not reserve", () => {
    expect(fileManifest["apiNamespace"]).toBe("brayne-whatsapp-connect");
  });

  it("declares assets that exist on disk", () => {
    const assets = fileManifest["assets"] as { dir: string; scripts?: string[]; styles?: string[] };
    expect(assets.dir).toBe("public");
    const declared = [...(assets.scripts ?? []), ...(assets.styles ?? [])];
    expect(declared.length).toBeGreaterThan(0);
    const missing = declared
      .map((rel) => `${assets.dir}/${rel}`)
      .filter((rel) => !existsSync(path.join(packageRoot, rel)));
    expect(missing).toEqual([]);
  });

  it("declares every settings key the server reads", () => {
    const schema = fileManifest["settingsSchema"] as Record<string, SettingsField>;
    expect(Object.keys(schema).sort()).toEqual([...SETTINGS_KEYS].sort());
    expect(schema["businessTimezone"]?.optionsSource).toBe("timezones");
    expect(schema["buttonPosition"]?.type).toBe("select");
    expect(schema["presetMessages"]?.type).toBe("text");
    expect(schema["analyticsEnabled"]?.type).toBe("boolean");
    expect(schema["whatsappNumber"]?.type).toBe("string");
  });

  it("keeps every select field to a bounded set of choices", () => {
    const schema = fileManifest["settingsSchema"] as Record<string, SettingsField>;
    const withoutChoices: string[] = [];
    let totalChoices = 0;
    for (const key of Object.keys(schema)) {
      if (schema[key]?.type !== "select") continue;
      const options = schema[key]?.options ?? [];
      if (options.length === 0) withoutChoices.push(key);
      totalChoices += options.length;
      for (const option of options) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.value.length).toBeLessThanOrEqual(200);
      }
    }
    expect(withoutChoices).toEqual([]);
    expect(totalChoices).toBeLessThanOrEqual(200);
  });
});
