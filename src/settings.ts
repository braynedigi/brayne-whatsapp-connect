/**
 * Settings normalisation and business-hours logic for Brayne WhatsApp Connect.
 *
 * Everything here is deliberately pure: the admin form stores whatever it is
 * given, and this module is the single place that decides what the widget
 * actually receives. That keeps hostile or half-typed values out of the page
 * (notably `buttonColor`, which is written into an inline style).
 */

import { resolveStrings, type ResolvedStrings, type WidgetStrings } from "./strings.js";

/** Plugin id. Must match `justflows.json` and the folder the host discovers. */
export const PLUGIN_ID = "justflows.brayne-whatsapp-connect";

/** Neutral plugin API namespace. The config endpoint is served under this. */
export const API_NAMESPACE = "brayne-whatsapp-connect";

/** Analytics events the plugin accepts. Anything else is rejected. */
export const ANALYTICS_EVENTS = ["open", "close", "preset", "send", "lead"] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** At most this many departments; their counters use indexes 0 … n-1. */
export const MAX_DEPARTMENTS = 5;
/** Only the WhatsApp catalog deep link form is accepted. */
export const CATALOG_URL_RE = /^https:\/\/wa\.me\/c\//;
export const DEFAULT_LEAD_CONSENT =
  "I agree that my name and message will be sent to this business over WhatsApp.";

/** Day numbers in JavaScript `Date#getDay()` order: 0 = Sunday … 6 = Saturday. */
export const DAY_SETS: Readonly<Record<string, readonly number[]>> = {
  weekdays: [1, 2, 3, 4, 5],
  "mon-sat": [1, 2, 3, 4, 5, 6],
  daily: [0, 1, 2, 3, 4, 5, 6],
};

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PRESET_MAX = 6;
const PRESET_MAX_LENGTH = 200;

/**
 * The `presetMessages` default from `justflows.json`, as the textarea would
 * submit it.
 *
 * `ctx.settings.get` reads the raw store and returns `undefined` for a key no
 * one has saved yet — only the admin settings route applies manifest defaults.
 * A freshly activated plugin would therefore offer no quick replies while the
 * admin form shows these, so the default is applied here instead.
 */
const DEFAULT_PRESET_MESSAGES =
  "I'd like a quote\nAre you available this week?\nPlease send me your pricing";

/** One opening window of the weekly schedule. Times are minutes of day. */
export interface HoursWindow {
  /** JavaScript day numbers the window opens on: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Minutes after local midnight the window opens. */
  open: number;
  /** Minutes after local midnight the window closes. `<= open` means it crosses midnight. */
  close: number;
}

export interface BusinessHours {
  enabled: boolean;
  /** IANA zone the open/closed state is judged in. */
  timezone: string;
  /** The weekly schedule. Empty means "always open" (a misconfiguration must not mute the button). */
  windows: HoursWindow[];
}

export interface WidgetButtonConfig {
  position: "bottom-right" | "bottom-left";
  color: string;
  size: "small" | "medium" | "large";
}

/**
 * A type alias (not an interface) so the object is assignable to the
 * `Record<string, unknown>` body of a plugin HTTP response without a cast.
 */
export type WidgetConfig = {
  /** Payload format version. Fields are only ever added; old clients ignore them. */
  version: 1;
  enabled: boolean;
  /** Digits only, no `+`. Empty when unset or invalid. */
  number: string;
  /** The greeting for the current page: open/closed wording, rule-resolved. */
  greeting: {
    open: string;
    closed: string;
  };
  presetMessages: string[];
  button: WidgetButtonConfig;
  hours: {
    enabled: boolean;
    /** IANA zone the state was judged in. */
    timezone: string;
    /** Evaluated on the server when the config is requested. */
    openNow: boolean;
    /** True when a holiday/exception day closed the business right now. */
    onHoliday: boolean;
    /** The matching holiday's label, or "" — drives the badge when closed. */
    holidayLabel: string;
    /** Custom open wording, operator-set; "" means the default. */
    openLabel: string;
    /** Custom closed wording, operator-set; "" means use the defaults. */
    closedLabel: string;
    /** Optional second line under a closed badge. */
    closedExtra: string;
    /** "Mon 09:00" of the next opening, when closed; "" otherwise. */
    nextLabel: string;
    /** Human schedule summary for the tooltip, e.g. "Mon–Fri 09:00–17:00". */
    summary: string;
    /** Hex badge colours; "" means the defaults. */
    openColor: string;
    closedColor: string;
  };
  /** The page rule that matched this request, for the admin mirror. */
  pageRule: { pattern: string } | null;
  /** Departments visitors can route a chat to; empty when unconfigured. */
  departments: Department[];
  /** The WhatsApp catalog deep link, "" when unset. */
  catalogUrl: string;
  /** The optional pre-chat lead form. */
  lead: {
    enabled: boolean;
    interests: string[];
    consentText: string;
  };
  /** Locale-resolved UI copy for the widget. */
  strings: ResolvedStrings;
  /** Operator-chosen identity shown in the panel header. */
  agent: { name: string; role: string; photoUrl: string };
  /** Append the page's UTM tags to the visitor's prefilled message. */
  utm: boolean;
  /** Count which page paths open the widget (aggregate, path only). */
  analyticsPages: boolean;
  /** The teaser bubble that invites a visitor to chat after a delay. */
  nudge: {
    enabled: boolean;
    delaySeconds: number;
    text: string;
    mode: "once-per-load" | "once-per-day";
  };
  analytics: boolean;
};

/** One page rule as the admin stored it. */
export interface PageRule {
  /** Path prefix, or a simple glob: `*` matches anything within a segment. */
  pattern: string;
  welcome: string;
  presets: string[];
}

/** One department a visitor can route a chat to. */
export interface Department {
  /** Chip label, e.g. "Sales". */
  name: string;
  /** Digits only, no `+`. */
  number: string;
  /** Optional single-glyph prefix, e.g. "💼". */
  icon: string;
}

/** Raw `settingsSchema` values as the admin stored them. */
export interface RawSettings {
  enabled?: unknown;
  whatsappNumber?: unknown;
  /** Legacy key kept only as a fallback for greeting migration. */
  welcomeMessage?: unknown;
  welcomeMessageOpen?: unknown;
  welcomeMessageClosed?: unknown;
  presetMessages?: unknown;
  buttonPosition?: unknown;
  buttonColor?: unknown;
  buttonSize?: unknown;
  businessHoursEnabled?: unknown;
  /** Legacy keys kept only to migrate into the `schedule` setting. */
  businessOpenTime?: unknown;
  businessCloseTime?: unknown;
  businessDays?: unknown;
  businessTimezone?: unknown;
  /** JSON array of `{ days, open, close }` windows. */
  schedule?: unknown;
  /** JSON array of `{ date, label }` or `{ from, to, label }` exception days. */
  holidays?: unknown;
  openLabel?: unknown;
  closedLabel?: unknown;
  closedExtra?: unknown;
  openColor?: unknown;
  closedColor?: unknown;
  /** JSON array of `{ name, number, icon }` department entries. */
  departments?: unknown;
  /** WhatsApp catalog deep link. */
  catalogUrl?: unknown;
  leadFormEnabled?: unknown;
  /** One interest per line, offered as a select in the lead form. */
  leadInterests?: unknown;
  /** The consent sentence shown with the lead form's checkbox. */
  leadConsentText?: unknown;
  /** Count which page paths open the widget; off keeps the path out of every counter. */
  analyticsPages?: unknown;
  /** Teaser bubble after a delay. */
  nudgeEnabled?: unknown;
  nudgeDelaySeconds?: unknown;
  nudgeText?: unknown;
  nudgeMode?: unknown;
  analyticsEnabled?: unknown;
  widgetLanguage?: unknown;
  pageRules?: unknown;
  agentName?: unknown;
  agentRole?: unknown;
  agentPhoto?: unknown;
  utmPropagation?: unknown;
}

/** One holiday/exception day entry. */
export interface Holiday {
  /** `YYYY-MM-DD` of a single closed day, or the first day of a closed range. */
  from: string;
  /** Last day of a closed range; equal to `from` for a single day. */
  to: string;
  /** Badge text for the closed state; may be empty. */
  label: string;
}

/**
 * Reduce a number to the digits `wa.me` accepts.
 *
 * Spaces, brackets, dashes and dots are stripped; a leading `+` is dropped
 * because the link is built from digits alone. An out-of-range result returns
 * `""`, which the caller treats as "not configured" rather than emitting a
 * link to nowhere.
 */
export function normalizeWhatsAppNumber(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/[\s()\-.]/g, "").replace(/^\+/, "");
  // E.164 numbers top out at 15 digits; 7 is the shortest plausible national number.
  if (!/^\d{7,15}$/.test(digits)) return "";
  return digits;
}

/** Accept `HH:MM` in 24-hour time; anything else falls back. */
export function parseClock(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && CLOCK_RE.test(raw.trim())) return raw.trim();
  return CLOCK_RE.test(fallback) ? fallback : "00:00";
}

/** Map the stored day-set onto JavaScript day numbers. Unknown values mean weekdays. */
export function resolveDays(raw: unknown): number[] {
  const key = typeof raw === "string" ? raw : "";
  const days = DAY_SETS[key] ?? DAY_SETS["weekdays"];
  return [...(days ?? [1, 2, 3, 4, 5])];
}

/** Split the textarea into bounded, non-empty preset replies. */
export function splitPresetMessages(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, PRESET_MAX)
    .map((line) => line.slice(0, PRESET_MAX_LENGTH));
}

/**
 * A colour is written straight into `style="--jwa-color: …"`, so only a hex
 * literal passes. Anything else uses the default rather than being escaped
 * into the attribute.
 */
export function resolveColor(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && HEX_COLOR_RE.test(raw.trim())) return raw.trim().toLowerCase();
  return HEX_COLOR_RE.test(fallback) ? fallback.trim().toLowerCase() : "#25d366";
}

export function resolvePosition(raw: unknown): WidgetButtonConfig["position"] {
  return raw === "bottom-left" ? "bottom-left" : "bottom-right";
}

export function resolveSize(raw: unknown): WidgetButtonConfig["size"] {
  return raw === "small" || raw === "large" ? raw : "medium";
}

/**
 * Coerce a stored setting to a boolean.
 *
 * Missing means "use the default", which is why an absent key must not read as
 * `false`: the admin form only writes keys the schema knows about.
 */
export function toBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === 1 || raw === "1") return true;
  if (raw === "false" || raw === 0 || raw === "0") return false;
  return fallback;
}

function asText(raw: unknown, fallback: string, maxLength: number): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  return value.length > 0 ? value.slice(0, maxLength) : fallback;
}

const DEFAULT_GREETING = "Hi! I'd like to know more about your services.";
export const PAGE_RULE_MAX = 10;
/** Paths only: letters, digits, `_`, `-`, `/`, plus the glob `*` and `?`. */
export const PAGE_RULE_PATTERN_RE = /^\/[A-Za-z0-9_\-/.*?]*$/;

/**
 * Parse the `pageRules` setting: a JSON array of `{ pattern, welcome,
 * presets }` entries. Anything malformed, oversized, or unsafe is dropped
 * rather than letting operator input reach the public page.
 */
export function parsePageRules(raw: unknown): PageRule[] {
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rules: PageRule[] = [];
  for (const entry of parsed.slice(0, PAGE_RULE_MAX)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const pattern =
      typeof candidate["pattern"] === "string" ? (candidate["pattern"] as string).trim() : "";
    if (!PAGE_RULE_PATTERN_RE.test(pattern)) continue;
    const welcome = asText(candidate["welcome"], "", 500);
    /** Rule presets arrive as an array of strings, unlike the textarea setting. */
    const rawPresets = candidate["presets"];
    const presets = Array.isArray(rawPresets)
      ? rawPresets
          .filter((preset): preset is string => typeof preset === "string")
          .map((preset) => preset.trim())
          .filter((preset) => preset.length > 0)
          .slice(0, 6)
          .map((preset) => preset.slice(0, 200))
      : [];
    if (welcome.length === 0 && presets.length === 0) continue;
    rules.push({ pattern, welcome, presets });
  }
  return rules;
}

/**
 * Turn an operator glob into an anchored matcher. Operators never write
 * regex: every regex special character is escaped first, then `*` becomes
 * `.*` and `?` becomes `.`.
 */
function patternToRegex(pattern: string): RegExp | null {
  try {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
  } catch {
    return null;
  }
}

/** First rule in document order whose pattern matches the page path. */
export function matchPageRule(rules: PageRule[], page: string): PageRule | null {
  const path = typeof page === "string" && page.length > 0 ? page : "/";
  for (const rule of rules) {
    const regex = patternToRegex(rule.pattern);
    if (regex !== null && regex.test(path)) return rule;
  }
  return null;
}

/**
 * An operator-chosen avatar: empty, a same-site media path, or an `https`
 * URL. Anything with whitespace, quotes, or angle brackets is refused, and
 * the value is written to `img.src`, never to markup.
 */
export function resolveAgentPhoto(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (value.length === 0 || value.length > 300) return "";
  if (!/^(https:\/\/|\/)/.test(value)) return "";
  if (/[\s"'<>]/.test(value)) return "";
  return value;
}

/** Wall-clock day and minutes-of-day for `at` in `timeZone`. */
function wallClock(at: Date, timeZone: string): { day: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    // An unknown zone must not break the page: judge in UTC instead.
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  }

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = Math.max(0, days.indexOf(weekday));
  return {
    day,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

/** `YYYY-MM-DD` of the local date for `at` in `timeZone`. */
export function localDateInZone(at: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const year = parts.find((part) => part.type === "year")?.value ?? "1970";
    const month = parts.find((part) => part.type === "month")?.value ?? "01";
    const day = parts.find((part) => part.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
  } catch {
    return "1970-01-01";
  }
}

/** Hour of day (0–23) for `at` in `timeZone`. */
export function localHourInZone(at: Date, timeZone: string): number {
  return Math.floor(wallClock(at, timeZone).minutes / 60);
}

function clockToMinutes(clock: string): number | null {
  const match = CLOCK_RE.exec(clock);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/** `HH:MM` for minutes of day. */
export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export const SCHEDULE_MAX_WINDOWS = 14;
export const HOLIDAYS_MAX = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time)) return false;
  const parsed = new Date(time);
  const [year, month, day] = value.split("-").map(Number);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

/**
 * Parse the `schedule` setting: a JSON array of `{ days, open, close }`
 * windows. Anything malformed or unsafe is dropped. A valid array is trusted
 * even when empty ("always open"); only when the stored value is not a JSON
 * array at all do the three legacy keys stand in. No windows and no legacy
 * keys read as "always open" (a misconfiguration must not mute the button).
 */
function windowsFromArray(parsed: unknown[]): HoursWindow[] {
  const windows: HoursWindow[] = [];
  for (const entry of parsed.slice(0, SCHEDULE_MAX_WINDOWS)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (!Array.isArray(candidate["days"])) continue;
    const days = (candidate["days"] as unknown[]).filter(
      (day): day is number =>
        typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6,
    );
    const unique = [...new Set(days)];
    if (unique.length === 0 || unique.length !== days.length) continue;
    const open = clockToMinutes(
      typeof candidate["open"] === "string" ? (candidate["open"] as string).trim() : "",
    );
    const close = clockToMinutes(
      typeof candidate["close"] === "string" ? (candidate["close"] as string).trim() : "",
    );
    if (open === null || close === null) continue;
    windows.push({ days: unique, open, close });
  }
  return windows;
}

/**
 * The active weekly schedule: the `schedule` setting when it is a JSON
 * array, else the three legacy keys (`businessDays`, `businessOpenTime`,
 * `businessCloseTime`) migrated into one equivalent window.
 */
export function parseSchedule(
  raw: unknown,
  legacyDays: unknown,
  legacyOpen: unknown,
  legacyClose: unknown,
): HoursWindow[] {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return windowsFromArray(parsed);
    } catch {
      /** Not JSON at all: fall through to the legacy migration. */
    }
  }
  const open = clockToMinutes(parseClock(legacyOpen, "09:00"));
  const close = clockToMinutes(parseClock(legacyClose, "17:00"));
  if (open === null || close === null) return [];
  return [{ days: resolveDays(legacyDays), open, close }];
}

/** Parse the `holidays` setting: single dates or `from`–`to` ranges. */
export function parseHolidays(raw: unknown): Holiday[] {
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const holidays: Holiday[] = [];
  for (const entry of parsed.slice(0, HOLIDAYS_MAX)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const date =
      typeof candidate["date"] === "string" && isValidIsoDate(candidate["date"])
        ? candidate["date"]
        : "";
    const from =
      typeof candidate["from"] === "string" && isValidIsoDate(candidate["from"])
        ? candidate["from"]
        : "";
    const to =
      typeof candidate["to"] === "string" && isValidIsoDate(candidate["to"])
        ? candidate["to"]
        : "";
    let start = "";
    let end = "";
    if (date.length > 0) {
      start = date;
      end = date;
    } else if (from.length > 0) {
      /** A reversed range is operator error: drop it rather than guess. */
      if (to.length > 0 && to < from) continue;
      start = from;
      end = to.length > 0 ? to : from;
    } else {
      continue;
    }
    const label =
      typeof candidate["label"] === "string" ? candidate["label"].trim().slice(0, 60) : "";
    holidays.push({ from: start, to: end, label });
  }
  return holidays;
}

/** The holiday whose range contains the local date, if any. */
export function holidayAt(holidays: Holiday[], at: Date, timeZone: string): Holiday | null {
  const date = localDateInZone(at, timeZone);
  for (const holiday of holidays) {
    if (date >= holiday.from && date <= holiday.to) return holiday;
  }
  return null;
}

/**
 * Whether the business is open at `at`.
 *
 * A closing time at or before the opening time is read as a shift that runs
 * past midnight (22:00 → 02:00), which is how a late-support team describes
 * itself. Disabled hours or an empty schedule read as open: a
 * misconfiguration must not silently silence the contact button.
 */
export function isWithinHours(hours: BusinessHours, at: Date): boolean {
  if (!hours.enabled) return true;
  if (hours.windows.length === 0) return true;

  const { day, minutes } = wallClock(at, hours.timezone || "UTC");
  for (const window of hours.windows) {
    if (!window.days.includes(day)) continue;
    if (window.open === window.close) return true;
    if (window.open < window.close) {
      if (minutes >= window.open && minutes < window.close) return true;
    } else if (minutes >= window.open || minutes < window.close) {
      return true;
    }
  }
  return false;
}

/**
 * The next instant (after `at`) at which some window opens, by wall clock in
 * the business zone. The wall-clock target is approximated with the current
 * offset and then refined, so a DST shift at most nudges the result by a few
 * iterations — it never loops.
 */
function wallOccurrence(day: number, minutes: number, after: Date, timeZone: string): Date {
  let current = wallClock(after, timeZone);
  let delta = ((day - current.day + 7) % 7) * 1440 + (minutes - current.minutes);
  let candidate = new Date(after.getTime() + delta * 60_000);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    current = wallClock(candidate, timeZone);
    delta = ((day - current.day + 7) % 7) * 1440 + (minutes - current.minutes);
    if (delta === 0) break;
    candidate = new Date(candidate.getTime() + delta * 60_000);
  }
  return candidate;
}

/** The earliest future opening instant, or null when the business never closes. */
export function nextOpeningInstant(hours: BusinessHours, at: Date): Date | null {
  if (!hours.enabled || hours.windows.length === 0) return null;
  const timeZone = hours.timezone || "UTC";
  let best: Date | null = null;
  for (const window of hours.windows) {
    for (const day of window.days) {
      const candidate = wallOccurrence(day, window.open, at, timeZone);
      if (
        candidate.getTime() > at.getTime() &&
        (best === null || candidate.getTime() < best.getTime())
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

/** Day numbers as a readable set, using the resolved string table. */
function daySetLabel(days: number[], strings: WidgetStrings): string {
  const sorted = days.slice().sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "1,2,3,4,5") return `${strings.dayNames[1]}${strings.tooltipRange}${strings.dayNames[5]}`;
  if (key === "1,2,3,4,5,6") return `${strings.dayNames[1]}${strings.tooltipRange}${strings.dayNames[6]}`;
  if (key === "0,1,2,3,4,5,6") return strings.daysEvery;
  return sorted.map((day) => strings.dayNames[day]).join(", ");
}

/** "Mon–Fri 09:00–17:00 · Sat 10:00–14:00" from the schedule. */
export function scheduleSummary(windows: HoursWindow[], strings: WidgetStrings): string {
  return windows
    .map(
      (window) =>
        `${daySetLabel(window.days, strings)} ${clockLabel(window.open)}${strings.tooltipRange}${clockLabel(window.close)}`,
    )
    .join(strings.tooltipSeparator);
}

/** A hex colour or "" (the CSS default stands in). */
export function resolveOptionalColor(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return HEX_COLOR_RE.test(value) ? value.toLowerCase() : "";
}

/** Parse the `departments` setting: a JSON array of `{ name, number, icon }`. */
export function parseDepartments(raw: unknown): Department[] {
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const departments: Department[] = [];
  for (const entry of parsed.slice(0, MAX_DEPARTMENTS)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const name =
      typeof candidate["name"] === "string" ? (candidate["name"] as string).trim().slice(0, 40) : "";
    const number = normalizeWhatsAppNumber(candidate["number"]);
    const icon =
      typeof candidate["icon"] === "string" ? (candidate["icon"] as string).trim().slice(0, 8) : "";
    if (name.length === 0 || number.length === 0) continue;
    departments.push({ name, number, icon });
  }
  return departments;
}

/**
 * The catalog chip target: only a `https://wa.me/c/…` deep link, nothing that
 * could break out of an `href`.
 */
export function resolveCatalogUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (value.length === 0 || value.length > 300) return "";
  if (!CATALOG_URL_RE.test(value)) return "";
  if (/[\s"'<>]/.test(value)) return "";
  return value;
}

/** Split the interest list into bounded, non-empty select options. */
export function parseLeadInterests(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8)
    .map((line) => line.slice(0, 60));
}

export const DEFAULT_NUDGE_TEXT = "👋 Need help? We're here to chat.";

/**
 * The nudge delay in seconds: a stored integer between 5 and 300, clamped to
 * the default when the value is missing or unparsable. Anything below 5
 * seconds is an annoyance, so it never leaves the admin gate.
 */
export function nudgeDelaySeconds(raw: unknown): number {
  if (typeof raw !== "string") return 15;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 5 || value > 300) return 15;
  return value;
}

/** Build the payload `/config` returns. Pure so tests can drive it directly. */
export function buildWidgetConfig(
  raw: RawSettings,
  siteTimezone: string,
  at: Date = new Date(),
  options: { page?: string; strings?: ResolvedStrings } = {},
): WidgetConfig {
  const timezone =
    typeof raw.businessTimezone === "string" && raw.businessTimezone.trim().length > 0
      ? raw.businessTimezone.trim()
      : siteTimezone || "UTC";

  const hours: BusinessHours = {
    enabled: toBoolean(raw.businessHoursEnabled, false),
    timezone,
    windows: parseSchedule(raw.schedule, raw.businessDays, raw.businessOpenTime, raw.businessCloseTime),
  };

  const strings = options.strings ?? resolveStrings("", "", "");
  /** A holiday closes the business even when the weekly schedule says open. */
  const holiday = hours.enabled ? holidayAt(parseHolidays(raw.holidays), at, timezone) : null;
  const openNow = holiday === null && isWithinHours(hours, at);
  const next = hours.enabled && !openNow ? nextOpeningInstant(hours, at) : null;
  let nextLabel = "";
  if (next !== null) {
    const local = wallClock(next, timezone);
    nextLabel = `${strings.values.dayNames[local.day]} ${clockLabel(local.minutes)}`;
  }

  /**
   * Greeting migration: the legacy single `welcomeMessage` seeds both the
   * open and closed wording until the operator saves the split fields.
   */
  const legacyGreeting = asText(raw.welcomeMessage, "", 500);
  const greetingFallback = legacyGreeting.length > 0 ? legacyGreeting : DEFAULT_GREETING;
  const greetingOpen = asText(raw.welcomeMessageOpen, greetingFallback, 500);
  const greetingClosed = asText(raw.welcomeMessageClosed, greetingFallback, 500);

  /** A page rule that matches this request overrides both greeting and presets. */
  const matched = matchPageRule(parsePageRules(raw.pageRules), options.page ?? "/");

  return {
    version: 1,
    enabled: toBoolean(raw.enabled, true) && normalizeWhatsAppNumber(raw.whatsappNumber).length > 0,
    number: normalizeWhatsAppNumber(raw.whatsappNumber),
    greeting: {
      open: matched && matched.welcome.length > 0 ? matched.welcome : greetingOpen,
      closed: matched && matched.welcome.length > 0 ? matched.welcome : greetingClosed,
    },
    presetMessages:
      matched !== null
        ? matched.presets
        : splitPresetMessages(raw.presetMessages ?? DEFAULT_PRESET_MESSAGES),
    button: {
      position: resolvePosition(raw.buttonPosition),
      color: resolveColor(raw.buttonColor, "#25D366"),
      size: resolveSize(raw.buttonSize),
    },
    hours: {
      enabled: hours.enabled,
      timezone,
      openNow,
      onHoliday: holiday !== null,
      holidayLabel: holiday !== null ? holiday.label : "",
      openLabel: asText(raw.openLabel, "", 60),
      closedLabel: asText(raw.closedLabel, "", 60),
      closedExtra: asText(raw.closedExtra, "", 120),
      nextLabel,
      summary: scheduleSummary(hours.windows, strings.values),
      openColor: resolveOptionalColor(raw.openColor),
      closedColor: resolveOptionalColor(raw.closedColor),
    },
    pageRule: matched !== null ? { pattern: matched.pattern } : null,
    departments: parseDepartments(raw.departments),
    catalogUrl: resolveCatalogUrl(raw.catalogUrl),
    lead: {
      enabled: toBoolean(raw.leadFormEnabled, false),
      interests: parseLeadInterests(raw.leadInterests),
      consentText: asText(raw.leadConsentText, DEFAULT_LEAD_CONSENT, 300),
    },
    strings,
    agent: {
      name: asText(raw.agentName, "", 60),
      role: asText(raw.agentRole, "", 60),
      photoUrl: resolveAgentPhoto(raw.agentPhoto),
    },
    utm: toBoolean(raw.utmPropagation, false),
    analyticsPages: toBoolean(raw.analyticsPages, false),
    nudge: {
      enabled: toBoolean(raw.nudgeEnabled, false),
      delaySeconds: nudgeDelaySeconds(raw.nudgeDelaySeconds),
      text: asText(raw.nudgeText, DEFAULT_NUDGE_TEXT, 120),
      mode: raw.nudgeMode === "once-per-day" ? "once-per-day" : "once-per-load",
    },
    analytics: toBoolean(raw.analyticsEnabled, true),
  };
}
