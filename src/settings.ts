/**
 * Settings normalisation and business-hours logic for Brayne WhatsApp Connect.
 *
 * Everything here is deliberately pure: the admin form stores whatever it is
 * given, and this module is the single place that decides what the widget
 * actually receives. That keeps hostile or half-typed values out of the page
 * (notably `buttonColor`, which is written into an inline style).
 */

/** Plugin id. Must match `justflows.json` and the folder the host discovers. */
export const PLUGIN_ID = "justflows.brayne-whatsapp-connect";

/** Neutral plugin API namespace. The config endpoint is served under this. */
export const API_NAMESPACE = "brayne-whatsapp-connect";

/** Analytics events the plugin accepts. Anything else is rejected. */
export const ANALYTICS_EVENTS = ["open", "close", "preset", "send"] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

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

export interface BusinessHours {
  enabled: boolean;
  /** 24-hour `HH:MM`. */
  open: string;
  /** 24-hour `HH:MM`. */
  close: string;
  /** JavaScript day numbers the business is open on. */
  days: number[];
  /** IANA zone the open/closed state is judged in. */
  timezone: string;
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
  enabled: boolean;
  /** Digits only, no `+`. Empty when unset or invalid. */
  number: string;
  welcomeMessage: string;
  presetMessages: string[];
  button: WidgetButtonConfig;
  hours: BusinessHours & {
    /** Evaluated on the server when the config is requested. */
    openNow: boolean;
  };
  analytics: boolean;
};

/** Raw `settingsSchema` values as the admin stored them. */
export interface RawSettings {
  enabled?: unknown;
  whatsappNumber?: unknown;
  welcomeMessage?: unknown;
  presetMessages?: unknown;
  buttonPosition?: unknown;
  buttonColor?: unknown;
  buttonSize?: unknown;
  businessHoursEnabled?: unknown;
  businessOpenTime?: unknown;
  businessCloseTime?: unknown;
  businessDays?: unknown;
  businessTimezone?: unknown;
  analyticsEnabled?: unknown;
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

function clockToMinutes(clock: string): number | null {
  const match = CLOCK_RE.exec(clock);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/**
 * Whether the business is open at `at`.
 *
 * A closing time at or before the opening time is read as a shift that runs
 * past midnight (22:00 → 02:00), which is how a late-support team describes
 * itself. Disabled hours, an unparsable clock, or an unknown day-set all read
 * as open: a misconfiguration must not silently silence the contact button.
 */
export function isWithinHours(hours: BusinessHours, at: Date): boolean {
  if (!hours.enabled) return true;

  const days = hours.days.length > 0 ? hours.days : [...(DAY_SETS["weekdays"] ?? [])];
  const open = clockToMinutes(hours.open);
  const close = clockToMinutes(hours.close);
  if (open === null || close === null) return true;

  const { day, minutes } = wallClock(at, hours.timezone || "UTC");
  if (!days.includes(day)) return false;

  if (open === close) return true;
  if (open < close) return minutes >= open && minutes < close;
  return minutes >= open || minutes < close;
}

/** Build the payload `/config` returns. Pure so tests can drive it directly. */
export function buildWidgetConfig(
  raw: RawSettings,
  siteTimezone: string,
  at: Date = new Date(),
): WidgetConfig {
  const timezone =
    typeof raw.businessTimezone === "string" && raw.businessTimezone.trim().length > 0
      ? raw.businessTimezone.trim()
      : siteTimezone || "UTC";

  const hours: BusinessHours = {
    enabled: toBoolean(raw.businessHoursEnabled, false),
    open: parseClock(raw.businessOpenTime, "09:00"),
    close: parseClock(raw.businessCloseTime, "17:00"),
    days: resolveDays(raw.businessDays),
    timezone,
  };

  return {
    enabled: toBoolean(raw.enabled, true) && normalizeWhatsAppNumber(raw.whatsappNumber).length > 0,
    number: normalizeWhatsAppNumber(raw.whatsappNumber),
    welcomeMessage: asText(
      raw.welcomeMessage,
      "Hi! I'd like to know more about your services.",
      500,
    ),
    presetMessages: splitPresetMessages(raw.presetMessages ?? DEFAULT_PRESET_MESSAGES),
    button: {
      position: resolvePosition(raw.buttonPosition),
      color: resolveColor(raw.buttonColor, "#25D366"),
      size: resolveSize(raw.buttonSize),
    },
    hours: { ...hours, openNow: isWithinHours(hours, at) },
    analytics: toBoolean(raw.analyticsEnabled, true),
  };
}
