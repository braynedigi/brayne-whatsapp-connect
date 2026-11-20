/**
 * Admin app contract for Brayne WhatsApp Connect.
 *
 * The plugin ships its own admin screen (`manifest.adminApp`), which the host
 * mounts in a same-origin iframe. That screen needs two things from the
 * plugin's own `ctx.http` routes: the current state to render, and a guarded
 * write path for the settings form. Both live here as pure logic so the route
 * handlers stay thin and every rule has a test:
 *
 * - `SETTING_DEFAULTS` — what the admin form shows before anything is saved.
 *   `ctx.settings.get` returns `undefined` for keys nobody has written, so the
 *   defaults from `justflows.json` are applied here rather than in the client.
 *   A test pins this map to the manifest so the two cannot drift.
 *
 * - `buildAdminSettings` — raw stored rows into the typed shape the form uses.
 *
 * - `validateAdminSettingsUpdate` — what `PUT admin-settings` accepts. The
 *   core settings route checks types against the schema; the plugin's own
 *   route goes further and checks the values themselves (clock format, hex
 *   colour, digit count), because a settings form that lies about its own
 *   rules is worse than none. The client mirrors these rules for instant
 *   feedback; the server repeats them because the client is not trusted.
 */

import {
  DAY_SETS,
  normalizeWhatsAppNumber,
  parseClock,
  resolveColor,
  resolvePosition,
  resolveSize,
  toBoolean,
  type RawSettings,
  type WidgetConfig,
} from "./settings.js";

/** Every settings key the admin form can show and the write route accepts. */
export const ADMIN_SETTING_KEYS = [
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
] as const;

export type AdminSettingKey = (typeof ADMIN_SETTING_KEYS)[number];

/** Form values: the two shapes the schema uses, nothing looser. */
export type AdminSettingValue = string | boolean;
export type AdminSettings = Record<AdminSettingKey, AdminSettingValue>;
export type AdminSettingsUpdate = Partial<AdminSettings>;

/**
 * What `GET admin-data` and a successful `PUT admin-settings` return: the
 * form's view of the settings, the resolved widget the overview card mirrors,
 * the aggregate counters, and the site time zone for the hours card. A type
 * alias (not an interface) so the route handler can return it without a cast.
 */
export type AdminDataPayload = {
  settings: AdminSettings;
  /** What the public widget resolves to right now; the overview card mirrors it. */
  widget: WidgetConfig;
  counters: Record<string, number>;
  siteTimeZone: string;
};

/** Failed validation: which field, and the message the form shows under it. */
export interface AdminSettingError {
  ok: false;
  field: AdminSettingKey | "";
  message: string;
}

export interface AdminSettingAccepted {
  ok: true;
  /** Only the known keys the caller sent, coerced and bounded. */
  values: AdminSettingsUpdate;
}

export type AdminSettingValidation = AdminSettingAccepted | AdminSettingError;

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** IANA ids are ASCII letters, digits, `_`, `+`, `-` and `/`, e.g. Africa/Accra. */
const TIMEZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]{0,15}(?:\/[A-Za-z0-9_+-]{1,15}){0,3}$/;

const WELCOME_MAX = 500;
const PRESET_MAX_LINES = 6;
const PRESET_MAX_LENGTH = 200;
const NUMBER_MAX_LENGTH = 32;
const TIMEZONE_MAX_LENGTH = 64;

/**
 * The `settingsSchema` defaults from `justflows.json`, applied for keys no
 * one has saved yet. The manifest test asserts this map matches the file, so
 * editing one without the other fails the gate.
 */
export const SETTING_DEFAULTS = {
  enabled: true,
  whatsappNumber: "",
  welcomeMessage: "Hi! I'd like to know more about your services.",
  presetMessages: "I'd like a quote\nAre you available this week?\nPlease send me your pricing",
  buttonPosition: "bottom-right",
  buttonColor: "#25D366",
  buttonSize: "medium",
  businessHoursEnabled: false,
  businessOpenTime: "09:00",
  businessCloseTime: "17:00",
  businessDays: "weekdays",
  businessTimezone: "",
  analyticsEnabled: true,
} satisfies AdminSettings;

/** Stored rows into the typed form view: defaults for unset keys, resolved values otherwise. */
export function buildAdminSettings(raw: RawSettings): AdminSettings {
  return {
    enabled: toBoolean(raw.enabled, SETTING_DEFAULTS.enabled),
    whatsappNumber: typeof raw.whatsappNumber === "string" ? raw.whatsappNumber.trim() : "",
    welcomeMessage:
      typeof raw.welcomeMessage === "string"
        ? raw.welcomeMessage.slice(0, WELCOME_MAX)
        : SETTING_DEFAULTS.welcomeMessage,
    presetMessages:
      typeof raw.presetMessages === "string" ? raw.presetMessages : SETTING_DEFAULTS.presetMessages,
    buttonPosition: resolvePosition(raw.buttonPosition),
    buttonColor: resolveColor(raw.buttonColor, SETTING_DEFAULTS.buttonColor),
    buttonSize: resolveSize(raw.buttonSize),
    businessHoursEnabled: toBoolean(
      raw.businessHoursEnabled,
      SETTING_DEFAULTS.businessHoursEnabled,
    ),
    businessOpenTime: parseClock(raw.businessOpenTime, SETTING_DEFAULTS.businessOpenTime),
    businessCloseTime: parseClock(raw.businessCloseTime, SETTING_DEFAULTS.businessCloseTime),
    businessDays: businessDaysKey(raw.businessDays),
    businessTimezone: typeof raw.businessTimezone === "string" ? raw.businessTimezone.trim() : "",
    analyticsEnabled: toBoolean(raw.analyticsEnabled, SETTING_DEFAULTS.analyticsEnabled),
  };
}

/** Map a stored day-set value back to its schema key without inventing one. */
function businessDaysKey(raw: unknown): string {
  return typeof raw === "string" && raw in DAY_SETS ? raw : "weekdays";
}

/**
 * Check one submitted settings object. Unknown keys are ignored (the core
 * route skips them too); every known key must pass its own rule. An accepted
 * result carries only the keys the caller sent, so a partial save is a real
 * partial save.
 */
export function validateAdminSettingsUpdate(body: unknown): AdminSettingValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, field: "", message: "Expected a JSON object of settings." };
  }

  const values: AdminSettingsUpdate = {};
  const submitted = body as Record<string, unknown>;
  let known = 0;

  for (const key of ADMIN_SETTING_KEYS) {
    if (!(key in submitted)) continue;
    known += 1;
    const raw = submitted[key];

    if (key === "enabled" || key === "businessHoursEnabled" || key === "analyticsEnabled") {
      if (typeof raw !== "boolean") {
        return { ok: false, field: key, message: "Choose on or off." };
      }
      values[key] = raw;
      continue;
    }

    if (typeof raw !== "string") {
      return { ok: false, field: key, message: "Expected text." };
    }
    const text = raw.trim();

    if (key === "whatsappNumber") {
      if (text.length > NUMBER_MAX_LENGTH) {
        return {
          ok: false,
          field: key,
          message: `Keep the number under ${NUMBER_MAX_LENGTH} characters.`,
        };
      }
      if (text.length > 0 && normalizeWhatsAppNumber(text) === "") {
        return {
          ok: false,
          field: key,
          message: "Enter digits only, 7 to 15 characters, optionally starting with +.",
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "welcomeMessage") {
      if (text.length > WELCOME_MAX) {
        return {
          ok: false,
          field: key,
          message: `Keep the welcome message under ${WELCOME_MAX} characters.`,
        };
      }
      values[key] = raw;
      continue;
    }

    if (key === "presetMessages") {
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length > PRESET_MAX_LINES) {
        return {
          ok: false,
          field: key,
          message: `Use at most ${PRESET_MAX_LINES} preset messages.`,
        };
      }
      if (lines.some((line) => line.length > PRESET_MAX_LENGTH)) {
        return {
          ok: false,
          field: key,
          message: `Keep each preset message under ${PRESET_MAX_LENGTH} characters.`,
        };
      }
      values[key] = raw;
      continue;
    }

    if (key === "buttonPosition") {
      if (text !== "bottom-right" && text !== "bottom-left") {
        return { ok: false, field: key, message: "Choose bottom right or bottom left." };
      }
      values[key] = text;
      continue;
    }

    if (key === "buttonColor") {
      if (text.length > 0 && !HEX_COLOR_RE.test(text)) {
        return {
          ok: false,
          field: key,
          message: "Enter a hex colour like #25D366, or leave it empty for WhatsApp green.",
        };
      }
      values[key] = text.toLowerCase();
      continue;
    }

    if (key === "buttonSize") {
      if (text !== "small" && text !== "medium" && text !== "large") {
        return { ok: false, field: key, message: "Choose small, medium, or large." };
      }
      values[key] = text;
      continue;
    }

    if (key === "businessOpenTime" || key === "businessCloseTime") {
      if (!CLOCK_RE.test(text)) {
        return {
          ok: false,
          field: key,
          message: "Use the 24-hour clock, HH:MM, for example 09:00.",
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "businessDays") {
      if (!(text in DAY_SETS)) {
        return {
          ok: false,
          field: key,
          message: "Choose Monday to Friday, Monday to Saturday, or every day.",
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "businessTimezone") {
      if (text.length > TIMEZONE_MAX_LENGTH || (text.length > 0 && !TIMEZONE_RE.test(text))) {
        return {
          ok: false,
          field: key,
          message:
            "Enter an IANA time zone such as Africa/Accra, or leave it empty for the site's.",
        };
      }
      values[key] = text;
      continue;
    }
  }

  return { ok: true, values };
}
