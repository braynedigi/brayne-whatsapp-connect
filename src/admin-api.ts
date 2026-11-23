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
  CATALOG_URL_RE,
  DEFAULT_LEAD_CONSENT,
  DEFAULT_NUDGE_TEXT,
  HOLIDAYS_MAX,
  MAX_DEPARTMENTS,
  PAGE_RULE_MAX,
  PAGE_RULE_PATTERN_RE,
  SCHEDULE_MAX_WINDOWS,
  clockLabel,
  normalizeWhatsAppNumber,
  parseSchedule,
  resolveAgentPhoto,
  resolveColor,
  resolveOptionalColor,
  resolvePosition,
  resolveSize,
  toBoolean,
  type RawSettings,
  type WidgetConfig,
} from "./settings.js";
import { LOCALES } from "./strings.js";

/** Every settings key the admin form can show and the write route accepts. */
export const ADMIN_SETTING_KEYS = [
  "enabled",
  "whatsappNumber",
  "welcomeMessageOpen",
  "welcomeMessageClosed",
  "presetMessages",
  "buttonPosition",
  "buttonColor",
  "buttonSize",
  "businessHoursEnabled",
  "schedule",
  "holidays",
  "businessTimezone",
  "openLabel",
  "closedLabel",
  "closedExtra",
  "openColor",
  "closedColor",
  "departments",
  "catalogUrl",
  "leadFormEnabled",
  "leadInterests",
  "leadConsentText",
  "analyticsEnabled",
  "analyticsPages",
  "nudgeEnabled",
  "nudgeDelaySeconds",
  "nudgeText",
  "nudgeMode",
  "widgetLanguage",
  "pageRules",
  "agentName",
  "agentRole",
  "agentPhoto",
  "utmPropagation",
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
  /** The site's local date (`YYYY-MM-DD`), the last day of the trend chart. */
  today: string;
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
const AGENT_MAX_LENGTH = 60;
const AGENT_PHOTO_MAX_LENGTH = 300;
const PAGE_RULES_MAX_LENGTH = 5000;
const LABEL_MAX_LENGTH = 60;
const CLOSED_EXTRA_MAX_LENGTH = 120;
const SCHEDULE_MAX_LENGTH = 5000;
const HOLIDAYS_MAX_LENGTH = 5000;
const GREETING_DEFAULT = "Hi! I'd like to know more about your services.";
const DEFAULT_SCHEDULE = '[{"days":[1,2,3,4,5],"open":"09:00","close":"17:00"}]';

/**
 * The `settingsSchema` defaults from `justflows.json`, applied for keys no
 * one has saved yet. The manifest test asserts this map matches the file, so
 * editing one without the other fails the gate.
 */
export const SETTING_DEFAULTS = {
  enabled: true,
  whatsappNumber: "",
  welcomeMessageOpen: GREETING_DEFAULT,
  welcomeMessageClosed: GREETING_DEFAULT,
  presetMessages: "I'd like a quote\nAre you available this week?\nPlease send me your pricing",
  buttonPosition: "bottom-right",
  buttonColor: "#25D366",
  buttonSize: "medium",
  businessHoursEnabled: false,
  schedule: DEFAULT_SCHEDULE,
  holidays: "[]",
  businessTimezone: "",
  openLabel: "",
  closedLabel: "",
  closedExtra: "",
  openColor: "",
  closedColor: "",
  departments: "[]",
  catalogUrl: "",
  leadFormEnabled: false,
  leadInterests: "",
  leadConsentText: DEFAULT_LEAD_CONSENT,
  analyticsEnabled: true,
  analyticsPages: false,
  nudgeEnabled: false,
  nudgeDelaySeconds: "15",
  nudgeText: DEFAULT_NUDGE_TEXT,
  nudgeMode: "once-per-load",
  widgetLanguage: "",
  pageRules: "",
  agentName: "",
  agentRole: "",
  agentPhoto: "",
  utmPropagation: false,
} satisfies AdminSettings;

/** Stored rows into the typed form view: defaults for unset keys, resolved values otherwise. */
export function buildAdminSettings(raw: RawSettings): AdminSettings {
  /** The legacy single welcome message seeds both split fields until overwritten. */
  const legacyGreeting =
    typeof raw.welcomeMessage === "string" && raw.welcomeMessage.trim().length > 0
      ? raw.welcomeMessage.trim().slice(0, WELCOME_MAX)
      : GREETING_DEFAULT;
  const openGreeting =
    typeof raw.welcomeMessageOpen === "string" && raw.welcomeMessageOpen.trim().length > 0
      ? raw.welcomeMessageOpen.slice(0, WELCOME_MAX)
      : legacyGreeting;
  const closedGreeting =
    typeof raw.welcomeMessageClosed === "string" && raw.welcomeMessageClosed.trim().length > 0
      ? raw.welcomeMessageClosed.slice(0, WELCOME_MAX)
      : legacyGreeting;

  return {
    enabled: toBoolean(raw.enabled, SETTING_DEFAULTS.enabled),
    whatsappNumber: typeof raw.whatsappNumber === "string" ? raw.whatsappNumber.trim() : "",
    welcomeMessageOpen: openGreeting,
    welcomeMessageClosed: closedGreeting,
    presetMessages:
      typeof raw.presetMessages === "string" ? raw.presetMessages : SETTING_DEFAULTS.presetMessages,
    buttonPosition: resolvePosition(raw.buttonPosition),
    buttonColor: resolveColor(raw.buttonColor, SETTING_DEFAULTS.buttonColor),
    buttonSize: resolveSize(raw.buttonSize),
    businessHoursEnabled: toBoolean(
      raw.businessHoursEnabled,
      SETTING_DEFAULTS.businessHoursEnabled,
    ),
    schedule: scheduleString(raw),
    holidays: typeof raw.holidays === "string" ? raw.holidays : SETTING_DEFAULTS.holidays,
    businessTimezone: typeof raw.businessTimezone === "string" ? raw.businessTimezone.trim() : "",
    openLabel:
      typeof raw.openLabel === "string" ? raw.openLabel.trim().slice(0, LABEL_MAX_LENGTH) : "",
    closedLabel:
      typeof raw.closedLabel === "string" ? raw.closedLabel.trim().slice(0, LABEL_MAX_LENGTH) : "",
    closedExtra:
      typeof raw.closedExtra === "string"
        ? raw.closedExtra.trim().slice(0, CLOSED_EXTRA_MAX_LENGTH)
        : "",
    openColor: resolveOptionalColor(raw.openColor),
    closedColor: resolveOptionalColor(raw.closedColor),
    departments:
      typeof raw.departments === "string" ? raw.departments : SETTING_DEFAULTS.departments,
    catalogUrl: typeof raw.catalogUrl === "string" ? raw.catalogUrl.trim() : "",
    leadFormEnabled: toBoolean(raw.leadFormEnabled, SETTING_DEFAULTS.leadFormEnabled),
    leadInterests: typeof raw.leadInterests === "string" ? raw.leadInterests : "",
    leadConsentText:
      typeof raw.leadConsentText === "string" && raw.leadConsentText.trim().length > 0
        ? raw.leadConsentText.trim().slice(0, 300)
        : SETTING_DEFAULTS.leadConsentText,
    analyticsEnabled: toBoolean(raw.analyticsEnabled, SETTING_DEFAULTS.analyticsEnabled),
    analyticsPages: toBoolean(raw.analyticsPages, SETTING_DEFAULTS.analyticsPages),
    nudgeEnabled: toBoolean(raw.nudgeEnabled, SETTING_DEFAULTS.nudgeEnabled),
    nudgeDelaySeconds:
      typeof raw.nudgeDelaySeconds === "string" && raw.nudgeDelaySeconds.trim().length > 0
        ? raw.nudgeDelaySeconds.trim()
        : SETTING_DEFAULTS.nudgeDelaySeconds,
    nudgeText:
      typeof raw.nudgeText === "string" ? raw.nudgeText.slice(0, 120) : SETTING_DEFAULTS.nudgeText,
    nudgeMode:
      raw.nudgeMode === "once-per-day" ? "once-per-day" : SETTING_DEFAULTS.nudgeMode,
    widgetLanguage: widgetLanguageKey(raw.widgetLanguage),
    pageRules: typeof raw.pageRules === "string" ? raw.pageRules : "",
    agentName:
      typeof raw.agentName === "string" ? raw.agentName.trim().slice(0, AGENT_MAX_LENGTH) : "",
    agentRole:
      typeof raw.agentRole === "string" ? raw.agentRole.trim().slice(0, AGENT_MAX_LENGTH) : "",
    agentPhoto:
      typeof raw.agentPhoto === "string" ? raw.agentPhoto.trim().slice(0, AGENT_PHOTO_MAX_LENGTH) : "",
    utmPropagation: toBoolean(raw.utmPropagation, SETTING_DEFAULTS.utmPropagation),
  };
}

/**
 * The `schedule` setting for the form: the stored JSON array when one was
 * saved, else the legacy `businessDays`/`businessOpenTime`/`businessCloseTime`
 * keys migrated into one equivalent window (the schema default stands in when
 * nothing at all is stored).
 */
function scheduleString(raw: RawSettings): string {
  if (typeof raw.schedule === "string") {
    try {
      const parsed = JSON.parse(raw.schedule);
      if (Array.isArray(parsed)) return raw.schedule;
    } catch {
      /** Not valid JSON: fall through to the legacy migration. */
    }
  }
  const windows = parseSchedule(
    raw.schedule,
    raw.businessDays,
    raw.businessOpenTime,
    raw.businessCloseTime,
  );
  if (windows.length === 0) return SETTING_DEFAULTS.schedule;
  return JSON.stringify(
    windows.map((window) => ({
      days: window.days,
      open: clockLabel(window.open),
      close: clockLabel(window.close),
    })),
  );
}

/** Map a stored language value back to a shipped locale without inventing one. */
function widgetLanguageKey(raw: unknown): string {
  if (raw === "auto") return "auto";
  if (typeof raw === "string" && raw in LOCALES) return raw;
  return "";
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

    if (
      key === "enabled" ||
      key === "businessHoursEnabled" ||
      key === "analyticsEnabled" ||
      key === "analyticsPages" ||
      key === "nudgeEnabled" ||
      key === "utmPropagation" ||
      key === "leadFormEnabled"
    ) {
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

    if (key === "welcomeMessageOpen" || key === "welcomeMessageClosed") {
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

    if (key === "widgetLanguage") {
      if (text !== "" && text !== "auto" && !(text in LOCALES)) {
        return { ok: false, field: key, message: "Choose a widget language from the list." };
      }
      values[key] = text;
      continue;
    }

    if (key === "pageRules") {
      const checked = validatePageRules(text);
      if (!checked.ok) {
        return { ok: false, field: key, message: checked.message };
      }
      values[key] = text;
      continue;
    }

    if (key === "agentName" || key === "agentRole") {
      if (text.length > AGENT_MAX_LENGTH) {
        return {
          ok: false,
          field: key,
          message: `Keep the ${key === "agentName" ? "name" : "role"} under ${AGENT_MAX_LENGTH} characters.`,
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "agentPhoto") {
      if (text.length > AGENT_PHOTO_MAX_LENGTH) {
        return {
          ok: false,
          field: key,
          message: `Keep the photo URL under ${AGENT_PHOTO_MAX_LENGTH} characters.`,
        };
      }
      if (text.length > 0 && resolveAgentPhoto(text) === "") {
        return {
          ok: false,
          field: key,
          message: "Use a same-site path like /media/logo.png or an https image URL.",
        };
      }
      values[key] = text;
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

    if (key === "schedule") {
      const checked = validateSchedule(text);
      if (!checked.ok) {
        return { ok: false, field: key, message: checked.message };
      }
      values[key] = text;
      continue;
    }

    if (key === "holidays") {
      const checked = validateHolidays(text);
      if (!checked.ok) {
        return { ok: false, field: key, message: checked.message };
      }
      values[key] = text;
      continue;
    }

    if (key === "openLabel" || key === "closedLabel") {
      if (text.length > LABEL_MAX_LENGTH) {
        return {
          ok: false,
          field: key,
          message: `Keep the ${key === "openLabel" ? "open" : "closed"} label under ${LABEL_MAX_LENGTH} characters.`,
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "closedExtra") {
      if (text.length > CLOSED_EXTRA_MAX_LENGTH) {
        return {
          ok: false,
          field: key,
          message: `Keep the extra closed line under ${CLOSED_EXTRA_MAX_LENGTH} characters.`,
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "openColor" || key === "closedColor") {
      if (text.length > 0 && resolveOptionalColor(text) === "") {
        return {
          ok: false,
          field: key,
          message: "Enter a hex colour like #12A150, or leave it empty for the default.",
        };
      }
      values[key] = text.length > 0 ? text.toLowerCase() : "";
      continue;
    }

    if (key === "departments") {
      const checked = validateDepartments(text);
      if (!checked.ok) {
        return { ok: false, field: key, message: checked.message };
      }
      values[key] = text;
      continue;
    }

    if (key === "catalogUrl") {
      if (text.length > 300) {
        return { ok: false, field: key, message: "Keep the catalog link under 300 characters." };
      }
      if (text.length > 0 && (!CATALOG_URL_RE.test(text) || /[\s"'<>]/.test(text))) {
        return {
          ok: false,
          field: key,
          message: "Use a WhatsApp catalog link that starts with https://wa.me/c/.",
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "leadInterests") {
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length > 8) {
        return { ok: false, field: key, message: "Use at most 8 lead form interests." };
      }
      if (lines.some((line) => line.length > 60)) {
        return { ok: false, field: key, message: "Keep each interest under 60 characters." };
      }
      values[key] = raw;
      continue;
    }

    if (key === "leadConsentText") {
      if (text.length > 300) {
        return { ok: false, field: key, message: "Keep the consent line under 300 characters." };
      }
      values[key] = raw;
      continue;
    }

    if (key === "nudgeDelaySeconds") {
      if (!/^\d{1,3}$/.test(text)) {
        return {
          ok: false,
          field: key,
          message: "Use a whole number of seconds, from 5 to 300.",
        };
      }
      const seconds = Number(text);
      if (seconds < 5 || seconds > 300) {
        return {
          ok: false,
          field: key,
          message: "Use a whole number of seconds, from 5 to 300.",
        };
      }
      values[key] = text;
      continue;
    }

    if (key === "nudgeText") {
      if (text.length > 120) {
        return { ok: false, field: key, message: "Keep the nudge text under 120 characters." };
      }
      values[key] = raw;
      continue;
    }

    if (key === "nudgeMode") {
      if (text !== "once-per-load" && text !== "once-per-day") {
        return { ok: false, field: key, message: "Choose once per page load or once per day." };
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

  /**
   * The consent line cannot be empty while the lead form is on — it is the
   * sentence the visitor agrees to. Only an explicitly sent empty value is
   * refused, so a partial save cannot break an already-configured form.
   */
  if (
    values.leadFormEnabled === true &&
    typeof values.leadConsentText === "string" &&
    values.leadConsentText.trim().length === 0
  ) {
    return {
      ok: false,
      field: "leadConsentText",
      message: "The consent line is required while the lead form is on.",
    };
  }

  return { ok: true, values };
}

/**
 * Page rules are stored as a JSON string. Every entry is checked here so a
 * malformed list cannot reach the config endpoint: at most ten rules, safe
 * glob patterns, and bounded welcome/preset text.
 */
function validatePageRules(text: string): { ok: true } | { ok: false; message: string } {
  if (text.length === 0) return { ok: true };
  if (text.length > PAGE_RULES_MAX_LENGTH) {
    return { ok: false, message: `Keep page rules under ${PAGE_RULES_MAX_LENGTH} characters.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "Page rules must be a JSON array." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: "Page rules must be a JSON array." };
  }
  if (parsed.length > PAGE_RULE_MAX) {
    return { ok: false, message: `Use at most ${PAGE_RULE_MAX} page rules.` };
  }
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "Each page rule must be an object with pattern, welcome and presets." };
    }
    const rule = entry as Record<string, unknown>;
    if (typeof rule["pattern"] !== "string" || !PAGE_RULE_PATTERN_RE.test(rule["pattern"].trim())) {
      return {
        ok: false,
        message: "Each pattern must start with / and use only letters, numbers, -, _, /, * and ?.",
      };
    }
    if (rule["welcome"] !== undefined) {
      if (typeof rule["welcome"] !== "string" || rule["welcome"].length > WELCOME_MAX) {
        return {
          ok: false,
          message: `Each rule's welcome message must be text under ${WELCOME_MAX} characters.`,
        };
      }
    }
    if (rule["presets"] !== undefined) {
      if (!Array.isArray(rule["presets"])) {
        return { ok: false, message: "Each rule's presets must be an array of text." };
      }
      if (rule["presets"].length > PRESET_MAX_LINES) {
        return { ok: false, message: `Use at most ${PRESET_MAX_LINES} presets per rule.` };
      }
      for (const preset of rule["presets"]) {
        if (typeof preset !== "string" || preset.length > PRESET_MAX_LENGTH) {
          return {
            ok: false,
            message: `Each preset must be text under ${PRESET_MAX_LENGTH} characters.`,
          };
        }
      }
    }
    if (!rule["welcome"] && !(Array.isArray(rule["presets"]) && rule["presets"].length > 0)) {
      return { ok: false, message: "Each page rule needs a welcome message or at least one preset." };
    }
  }
  return { ok: true };
}

/**
 * The schedule is a JSON array of `{ days, open, close }` windows. Every
 * window is checked so a malformed list cannot reach the config endpoint.
 */
function validateSchedule(text: string): { ok: true } | { ok: false; message: string } {
  if (text.length > SCHEDULE_MAX_LENGTH) {
    return { ok: false, message: `Keep the schedule under ${SCHEDULE_MAX_LENGTH} characters.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "The schedule must be a JSON array of windows." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: "The schedule must be a JSON array of windows." };
  }
  if (parsed.length > SCHEDULE_MAX_WINDOWS) {
    return { ok: false, message: `Use at most ${SCHEDULE_MAX_WINDOWS} windows.` };
  }
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "Each window needs days, open and close." };
    }
    const window = entry as Record<string, unknown>;
    if (!Array.isArray(window["days"])) {
      return { ok: false, message: "Each window needs at least one day." };
    }
    const days = window["days"] as unknown[];
    if (
      days.length === 0 ||
      days.some((day) => typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(days).size !== days.length
    ) {
      return {
        ok: false,
        message: "Each window's days must be unique numbers from 0 (Sunday) to 6 (Saturday).",
      };
    }
    for (const field of ["open", "close"] as const) {
      const clock = window[field];
      if (typeof clock !== "string" || !CLOCK_RE.test(clock.trim())) {
        return {
          ok: false,
          message: "Each window's open and close must use the 24-hour clock, HH:MM.",
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Holidays are a JSON array of `{ date, label }` single days or
 * `{ from, to, label }` closed ranges.
 */
function validateHolidays(text: string): { ok: true } | { ok: false; message: string } {
  if (text.length > HOLIDAYS_MAX_LENGTH) {
    return { ok: false, message: `Keep the holiday list under ${HOLIDAYS_MAX_LENGTH} characters.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "The holiday list must be a JSON array." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: "The holiday list must be a JSON array." };
  }
  if (parsed.length > HOLIDAYS_MAX) {
    return { ok: false, message: `Use at most ${HOLIDAYS_MAX} holiday entries.` };
  }
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "Each holiday needs a date (or from and to) and a label." };
    }
    const holiday = entry as Record<string, unknown>;
    const date =
      typeof holiday["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(holiday["date"].trim())
        ? holiday["date"].trim()
        : "";
    const from =
      typeof holiday["from"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(holiday["from"].trim())
        ? holiday["from"].trim()
        : "";
    const to =
      typeof holiday["to"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(holiday["to"].trim())
        ? holiday["to"].trim()
        : "";
    if (date.length === 0 && from.length === 0) {
      return { ok: false, message: "Each holiday needs a date, or a from date." };
    }
    if (date.length === 0 && to.length > 0 && to < from) {
      return { ok: false, message: "A holiday range's to date cannot be before its from date." };
    }
    if (holiday["label"] !== undefined && typeof holiday["label"] !== "string") {
      return { ok: false, message: "Each holiday's label must be text." };
    }
    if (typeof holiday["label"] === "string" && holiday["label"].length > 60) {
      return { ok: false, message: "Keep each holiday label under 60 characters." };
    }
  }
  return { ok: true };
}

/**
 * Departments are a JSON array of `{ name, number, icon }`. Names must be
 * short and numbers must normalise to a real WhatsApp number.
 */
function validateDepartments(text: string): { ok: true } | { ok: false; message: string } {
  if (text.length === 0) return { ok: true };
  if (text.length > 3000) {
    return { ok: false, message: "Keep the department list under 3000 characters." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "Departments must be a JSON array." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: "Departments must be a JSON array." };
  }
  if (parsed.length > MAX_DEPARTMENTS) {
    return { ok: false, message: `Use at most ${MAX_DEPARTMENTS} departments.` };
  }
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "Each department needs a name and a number." };
    }
    const department = entry as Record<string, unknown>;
    if (
      typeof department["name"] !== "string" ||
      department["name"].trim().length === 0 ||
      department["name"].trim().length > 40
    ) {
      return {
        ok: false,
        message: "Each department's name must be text under 40 characters.",
      };
    }
    if (
      typeof department["number"] !== "string" ||
      normalizeWhatsAppNumber(department["number"]) === ""
    ) {
      return {
        ok: false,
        message: "Each department needs a WhatsApp number: digits only, 7 to 15 characters.",
      };
    }
    if (department["icon"] !== undefined && typeof department["icon"] !== "string") {
      return { ok: false, message: "Each department's icon must be text." };
    }
    if (typeof department["icon"] === "string" && department["icon"].length > 8) {
      return { ok: false, message: "Keep each department icon under 8 characters." };
    }
  }
  return { ok: true };
}
