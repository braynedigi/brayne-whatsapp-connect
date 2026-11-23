/**
 * UI copy for the public widget.
 *
 * The widget never hardcodes a user-visible sentence: the config payload
 * ships a resolved `strings` table, and the widget falls back to its own
 * built-in English copy when the field is missing or a value has the wrong
 * type. `resolveStrings` picks the table per request (explicit setting →
 * browser language → page locale → English); adding a language means adding
 * one table to `LOCALES`.
 *
 * Every value here is written with `textContent` by the widget, so a hostile
 * value can never become markup — but the tables are still typed and bounded:
 * a locale that omits a key or changes a value's type fails its tests.
 */

export interface WidgetStrings {
  /** Floating action button, aria-label. */
  fabLabel: string;
  /** Panel header title. */
  panelTitle: string;
  /** Header avatar glyph. */
  avatarGlyph: string;
  /** Close button glyph. */
  closeLabel: string;
  /** Close button, aria-label. */
  closeAriaLabel: string;
  /** Status line: business hours on, currently open. */
  statusOpen: string;
  /** Status line: business hours on, currently closed. */
  statusClosed: string;
  /** Status line when closed and the next opening is known; `{next}` is replaced. */
  statusClosedNext: string;
  /** Status line: business hours off. */
  statusIdle: string;
  /** Quick-reply chip group, aria-label. */
  presetsAriaLabel: string;
  /** Visually hidden label for the message box. */
  messageLabel: string;
  /** Message box placeholder. */
  messagePlaceholder: string;
  /** Send button label. */
  sendLabel: string;
  /** Day-set label for Monday–Friday. */
  daysMonFri: string;
  /** Day-set label for Monday–Saturday. */
  daysMonSat: string;
  /** Day-set label for every day. */
  daysEvery: string;
  /** Catalog chip label. */
  catalogLabel: string;
  /** Department chip row, aria-label. */
  departmentsAriaLabel: string;
  /** Lead form: name field label. */
  leadNameLabel: string;
  /** Lead form: interest select label. */
  leadInterestLabel: string;
  /** Lead form: the continue button label. */
  leadContinueLabel: string;
  /** Lead form: name missing. */
  leadNameInvalid: string;
  /** Lead form: consent not ticked. */
  leadConsentRequired: string;
  /** Nudge bubble default text (the operator's own text stands in). */
  nudgeDefault: string;
  /** Nudge bubble dismiss button, aria-label. */
  nudgeCloseLabel: string;
  /** Day names in JavaScript `Date#getDay()` order: 0 = Sunday … 6 = Saturday. */
  dayNames: string[];
  /** Joins the day label and the hours in the status tooltip. */
  tooltipSeparator: string;
  /** Joins open and close times in the status tooltip. */
  tooltipRange: string;
}

export const STRINGS_EN: WidgetStrings = {
  fabLabel: "Chat with us on WhatsApp",
  panelTitle: "Chat with us",
  avatarGlyph: "💬",
  closeLabel: "×",
  closeAriaLabel: "Close chat panel",
  statusOpen: "Open now",
  statusClosed: "Closed — messages welcome",
  statusClosedNext: "Closed — opens {next}",
  statusIdle: "We usually reply within a few minutes.",
  presetsAriaLabel: "Quick replies",
  messageLabel: "Your message",
  messagePlaceholder: "Type a message…",
  sendLabel: "Send on WhatsApp",
  daysMonFri: "Mon–Fri",
  daysMonSat: "Mon–Sat",
  daysEvery: "Every day",
  catalogLabel: "Browse products",
  departmentsAriaLabel: "Choose who to chat with",
  leadNameLabel: "Your name",
  leadInterestLabel: "What's it about?",
  leadContinueLabel: "Continue",
  leadNameInvalid: "Please enter your name.",
  leadConsentRequired: "Please tick the consent box to continue.",
  nudgeDefault: "👋 Need help? We're here to chat.",
  nudgeCloseLabel: "Dismiss",
  dayNames: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  tooltipSeparator: " · ",
  tooltipRange: "–",
};

export interface ResolvedStrings {
  /** BCP 47 tag of the table shipped in `values`. */
  locale: string;
  values: WidgetStrings;
}

/**
 * Every locale the widget can render. Adding a language means adding one
 * table here (and nothing else): the settings select, the resolver and the
 * tests all key off this map.
 */
export const LOCALES: Readonly<Record<string, WidgetStrings>> = {
  en: STRINGS_EN,
};

/** Exact tag first, then its base language (`fr-FR` → `fr`), else nothing. */
function bestMatch(language: string): string | null {
  if (!language) return null;
  const normalized = language.replace(/_/g, "-").toLowerCase();
  if (LOCALES[normalized]) return normalized;
  const base = normalized.split("-")[0];
  if (base && LOCALES[base]) return base;
  return null;
}

/**
 * Pick the UI copy for the current request.
 *
 * Resolution chain, first hit wins:
 * 1. an explicit operator setting (`"auto"` defers to the visitor's browser);
 * 2. the visitor's page locale (the site page the widget sits on);
 * 3. English, which always exists.
 */
export function resolveStrings(
  explicit: string,
  browserLang: string,
  pageLocale: string,
): ResolvedStrings {
  const tried: string[] = [];
  if (explicit === "auto") {
    tried.push(browserLang);
  } else if (explicit) {
    tried.push(explicit);
  }
  tried.push(pageLocale);
  for (const language of tried) {
    const match = bestMatch(language);
    if (match) {
      const table = LOCALES[match];
      if (table) return { locale: match, values: table };
    }
  }
  return { locale: "en", values: STRINGS_EN };
}
