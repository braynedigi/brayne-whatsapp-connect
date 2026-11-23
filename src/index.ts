import type { PluginContext, PluginHttpRequest, PluginModule } from "@justflows/sdk";
import {
  API_NAMESPACE,
  MAX_DEPARTMENTS,
  PLUGIN_ID,
  buildWidgetConfig,
  localDateInZone,
  localHourInZone,
  parseDepartments,
  toBoolean,
  type RawSettings,
} from "./settings.js";
import { resolveStrings } from "./strings.js";
import {
  buildAdminSettings,
  validateAdminSettingsUpdate,
  type AdminDataPayload,
} from "./admin-api.js";
import {
  ensureCounters,
  incrementCounter,
  incrementDayCounter,
  incrementDepartmentCounter,
  incrementHourCounter,
  incrementPageCounter,
  isAnalyticsEvent,
  readCounters,
} from "./counters.js";

/** Every key the widget reads, so one config request fills them in a single pass. */
const SETTING_KEYS = [
  "enabled",
  "whatsappNumber",
  "welcomeMessage",
  "welcomeMessageOpen",
  "welcomeMessageClosed",
  "presetMessages",
  "buttonPosition",
  "buttonColor",
  "buttonSize",
  "businessHoursEnabled",
  "businessOpenTime",
  "businessCloseTime",
  "businessDays",
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

async function readRawSettings(ctx: PluginContext): Promise<RawSettings> {
  const values = await Promise.all(SETTING_KEYS.map((key) => ctx.settings.get(key)));
  const raw: RawSettings = {};
  SETTING_KEYS.forEach((key, index) => {
    raw[key] = values[index];
  });
  return raw;
}

/** The site's zone unless the operator pinned the widget to another one. */
async function siteTimeZone(ctx: PluginContext): Promise<string> {
  try {
    return await ctx.i18n.timeZone();
  } catch {
    return "UTC";
  }
}

/** The site's default locale code, or `en` when the host cannot say. */
async function siteDefaultLocale(ctx: PluginContext): Promise<string> {
  try {
    return await ctx.i18n.defaultLocale();
  } catch {
    return "en";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `GET /api/brayne-whatsapp-connect/config` (also reachable through the
 * legacy `/ext/<plugin id>/config` alias).
 *
 * The widget asks for this on every page rather than having settings inlined,
 * because `html.head` is a synchronous filter and cannot await `ctx.settings`.
 * `no-store` keeps a saved setting visible on the very next page load.
 */
async function handleConfig(ctx: PluginContext, req: PluginHttpRequest) {
  const [raw, timezone] = await Promise.all([readRawSettings(ctx), siteTimeZone(ctx)]);
  const query = req.query && typeof req.query === "object" ? req.query : {};
  /** The page the widget sits on, for page rules; bounded before matching. */
  const page = typeof query["page"] === "string" ? query["page"].slice(0, 300) : "";
  /** `navigator.language`, only consulted when the operator picked "auto". */
  const browserLang = typeof query["lang"] === "string" ? query["lang"].slice(0, 32) : "";
  const pageLocale =
    typeof req.locale === "string" && req.locale.length > 0
      ? req.locale
      : await siteDefaultLocale(ctx);
  const explicit = typeof raw.widgetLanguage === "string" ? raw.widgetLanguage : "";
  const strings = resolveStrings(explicit, browserLang, pageLocale);
  const config = buildWidgetConfig(raw, timezone, new Date(), { page, strings });
  return {
    body: config,
    headers: { "Cache-Control": "no-store" },
    /** A statically exported page runs on another origin and reads this config. */
    cors: true,
  };
}

/**
 * `POST /api/brayne-whatsapp-connect/analytics`.
 *
 * `csrf: false` because the caller is an anonymous visitor on a public page
 * with no session token to present; the counters carry no credentials and no
 * personal data. In exchange the handler refuses any request whose `Origin`
 * is not this site (`trustedOrigin === false`) and the host rate-limits the
 * route, so a hostile page cannot drive someone else's counter.
 *
 * The event travels as a query parameter and the request carries no body, so
 * it stays a CORS "simple request": a body would be `application/json` and
 * force a preflight the plugin router does not answer on an exported page.
 */
async function handleAnalytics(ctx: PluginContext, req: PluginHttpRequest) {
  const fromBody =
    isRecord(req.body) && typeof req.body["event"] === "string" ? req.body["event"] : "";
  const fromQuery = typeof req.query["event"] === "string" ? req.query["event"] : "";
  const event = fromBody || fromQuery;
  if (!isAnalyticsEvent(event)) {
    return { status: 400, body: { error: "Unknown event" }, cors: true };
  }
  if (req.trustedOrigin === false) {
    return { status: 403, body: { error: "Cross-origin request refused" }, cors: true };
  }

  const raw = await readRawSettings(ctx);
  if (!toBoolean(raw.analyticsEnabled, true)) {
    return { status: 200, body: { recorded: false }, cors: true };
  }

  const timezone = await siteTimeZone(ctx);
  const now = new Date();
  const localDate = localDateInZone(now, timezone);
  const localHour = localHourInZone(now, timezone);
  const departments = parseDepartments(raw.departments);

  let departmentIndex: number | null = null;
  let count: number | null;
  if (event === "send") {
    /** A send may name the department chip the visitor chose (0-based index). */
    const deptRaw = typeof req.query["dept"] === "string" ? req.query["dept"] : "";
    const dept = deptRaw.length > 0 ? Number(deptRaw) : Number.NaN;
    if (Number.isInteger(dept) && dept >= 0 && dept < MAX_DEPARTMENTS) {
      departmentIndex = dept;
      count = await incrementDepartmentCounter(ctx, dept);
    } else {
      count = await incrementCounter(ctx, "send");
    }
  } else {
    count = await incrementCounter(ctx, event);
  }

  /** Trend-chart day buckets, for every event the overview charts. */
  if (event === "open" || event === "preset" || event === "send") {
    await incrementDayCounter(ctx, event, localDate);
  }
  /** Busiest-hours buckets. */
  if (event === "open") await incrementHourCounter(ctx, "open", localHour);
  if (event === "send") await incrementHourCounter(ctx, "send", localHour);
  /** Page breakdown: only when the operator opted in, and the path only. */
  if (event === "open" && toBoolean(raw.analyticsPages, false)) {
    const pageParam =
      typeof req.query["page"] === "string" ? req.query["page"].slice(0, 200) : "";
    if (pageParam.startsWith("/") && !/[\s?#]/.test(pageParam)) {
      await incrementPageCounter(ctx, pageParam, localDate);
    }
  }

  /** Stage 4.5: administrators may subscribe to these events as webhooks. */
  emitWidgetEvent(ctx, event, departmentIndex !== null ? departments[departmentIndex]?.name ?? "" : "");

  return { status: 200, body: { recorded: count !== null, count }, cors: true };
}

/** Event names administrators can subscribe to (the plugin's own namespace). */
const WIDGET_EVENT_NAMES = [
  `${PLUGIN_ID}.open`,
  `${PLUGIN_ID}.close`,
  `${PLUGIN_ID}.preset`,
  `${PLUGIN_ID}.send`,
  `${PLUGIN_ID}.lead`,
] as const;

/**
 * Fire-and-forget automation event. Never throws into the analytics path:
 * a webhook queue hiccup must not eat a counter or a visitor's send. The
 * payload is JSON-safe and carries no personal data — just the event and the
 * department chip the visitor chose, when there is one.
 */
function emitWidgetEvent(ctx: PluginContext, event: string, department: string): void {
  try {
    ctx.hooks
      .emit(`${PLUGIN_ID}.${event}`, { event, department })
      .catch(() => {
        /** Subscriber failures are the host's concern, not the widget's. */
      });
  } catch {
    /** Older hosts without `hooks.emit` simply skip automation events. */
  }
}

/**
 * `GET /api/brayne-whatsapp-connect/admin-data`.
 *
 * Everything the plugin's own admin screen needs in one request: the settings
 * form view (defaults applied), the resolved widget the overview card mirrors,
 * the aggregate counters, and the site time zone. Administrator-only: the
 * admin app iframe runs with the operator's session, but the route never
 * trusts the frame to be the only caller.
 */
async function handleAdminData(ctx: PluginContext, req: PluginHttpRequest) {
  const denied = requireAdministrator(req);
  if (denied) return denied;
  const [raw, timezone, counters, pageLocale] = await Promise.all([
    readRawSettings(ctx),
    siteTimeZone(ctx),
    readCounters(ctx),
    siteDefaultLocale(ctx),
  ]);
  const explicit = typeof raw.widgetLanguage === "string" ? raw.widgetLanguage : "";
  const payload: AdminDataPayload = {
    settings: buildAdminSettings(raw),
    widget: buildWidgetConfig(raw, timezone, new Date(), {
      strings: resolveStrings(explicit, "", pageLocale),
    }),
    counters,
    siteTimeZone: timezone,
    today: localDateInZone(new Date(), timezone),
  };
  return { body: payload, headers: { "Cache-Control": "no-store" } };
}

/**
 * `GET /api/brayne-whatsapp-connect/csv`.
 *
 * Every counter row as CSV, for the admin app's export button. Administrator
 * only, never cached, and built from the same read the admin screen shows.
 */
async function handleCsv(ctx: PluginContext, req: PluginHttpRequest) {
  const denied = requireAdministrator(req);
  if (denied) return denied;
  const counters = await readCounters(ctx);
  const lines = Object.keys(counters)
    .sort()
    .map((key) => `${key},${counters[key]}`);
  return {
    body: ["counter,count", ...lines].join("\n"),
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="whatsapp-connect-counters.csv"',
      "Cache-Control": "no-store",
    },
  };
}

/**
 * `PUT /api/brayne-whatsapp-connect/admin-settings`.
 *
 * The admin app's save button. The host enforces the session CSRF token on
 * every non-GET plugin route (the app reads the `jf_csrf` cookie itself and
 * sends it as `x-csrf-token`); this handler adds the role check and the value
 * rules from `validateAdminSettingsUpdate`. Only the keys the caller sent are
 * written, so a partial save is a real partial save, and the response is the
 * fresh `admin-data` payload so the screen re-renders from one source.
 */
async function handleAdminSettings(ctx: PluginContext, req: PluginHttpRequest) {
  const denied = requireAdministrator(req);
  if (denied) return denied;
  const checked = validateAdminSettingsUpdate(req.body);
  if (!checked.ok) {
    return { status: 400, body: { error: checked.message, field: checked.field } };
  }
  for (const [key, value] of Object.entries(checked.values)) {
    await ctx.settings.set(key, value);
  }
  /**
   * `revalidate` because a saved setting can change what public pages show
   * through the widget's config fetch; the host drops page caches once this
   * response is sent, exactly like the core plugin settings route.
   */
  const fresh = await handleAdminData(ctx, req);
  return { ...fresh, revalidate: true };
}

/** 403 response for anything an administrator did not ask for. */
function requireAdministrator(req: PluginHttpRequest) {
  if (req.session?.role === "administrator") return null;
  return {
    status: 403,
    body: { error: "Administrator access required" },
    headers: { "Cache-Control": "no-store" },
  };
}

const brayneWhatsAppConnect: PluginModule = {
  manifest: {
    id: PLUGIN_ID,
    apiNamespace: API_NAMESPACE,
    name: "Brayne WhatsApp Connect",
    version: "0.2.0",
    description:
      "Adds a floating WhatsApp contact button with a welcome message, preset replies, configurable position and colours, and business-hours open/closed state.",
    author: "Brayne Smart solutions Corp",
    homepage: "https://braynesmartsolutions.com",
    license: "GPL-2.0-or-later",
    engines: { justflows: ">=0.4.0 <0.5.0" },
    permissions: ["admin:extend"],
    main: "index.js",
    registry: {
      commercialMarketplace: false,
      listed: false,
      free: true,
      comingSoon: true,
    },
    adminSection: {
      label: "WhatsApp Connect",
      icon: "💬",
    },
    adminMenu: [
      {
        id: "whatsapp-connect",
        label: "WhatsApp Connect",
        path: "",
        icon: "💬",
        domain: "plugin",
        listed: true,
      },
    ],
    /**
     * The plugin's own admin screen, mounted by the host in a same-origin
     * iframe at `/admin/plugins/<id>`. The app renders the overview (live
     * counters, widget status) and, in-frame, the five settings screens
     * designed for it. The host owns the shell around it; this app talks only
     * to its own `ctx.http` routes through `@justflows/admin-bridge`.
     */
    adminApp: {
      dir: "admin",
      routes: [{ path: "", entry: "index.html", title: "WhatsApp Connect" }],
      locales: { en: "locales/en.json" },
    },
    settingsSchema: {
      enabled: {
        type: "boolean",
        label: "Show the WhatsApp button",
        description: "Turn the floating contact button off without uninstalling the plugin.",
        default: true,
      },
      whatsappNumber: {
        type: "string",
        label: "WhatsApp number",
        description:
          "International format without spaces or brackets, e.g. 15551234567 or +233201234567. Leave empty to hide the button.",
        default: "",
      },
      welcomeMessageOpen: {
        type: "text",
        label: "Welcome message while open",
        description: "Prefills the chat when a visitor opens the button during business hours.",
        default: "Hi! I'd like to know more about your services.",
      },
      welcomeMessageClosed: {
        type: "text",
        label: "Welcome message while closed",
        description:
          "Prefills the chat when the business is closed. Falls back to the open message until you set it.",
        default: "Hi! I'd like to know more about your services.",
      },
      presetMessages: {
        type: "text",
        label: "Preset messages",
        description: "One per line. Each becomes a tappable quick reply above the message box.",
        default: "I'd like a quote\nAre you available this week?\nPlease send me your pricing",
      },
      buttonPosition: {
        type: "select",
        label: "Button position",
        description:
          "Corner the button sits in. It moves above the browser's own UI on small screens.",
        default: "bottom-right",
        options: [
          { value: "bottom-right", label: "Bottom right" },
          { value: "bottom-left", label: "Bottom left" },
        ],
      },
      buttonColor: {
        type: "string",
        label: "Button colour",
        description: "Any CSS colour. Leave empty for WhatsApp green (#25D366).",
        default: "#25D366",
      },
      buttonSize: {
        type: "select",
        label: "Button size",
        default: "medium",
        options: [
          { value: "small", label: "Small (48px)" },
          { value: "medium", label: "Medium (56px)" },
          { value: "large", label: "Large (64px)" },
        ],
      },
      businessHoursEnabled: {
        type: "boolean",
        label: "Show business hours",
        description:
          "Shows an Open / Closed badge and, when closed, still lets visitors leave a message.",
        default: false,
      },
      schedule: {
        type: "text",
        label: "Weekly schedule",
        description:
          "JSON list of opening windows. Shape: [{\"days\": [1,2,3,4,5], \"open\": \"09:00\", \"close\": \"17:00\"}]. Days: 0 = Sunday … 6 = Saturday. A close time at or before the open time runs past midnight.",
        default: '[{"days":[1,2,3,4,5],"open":"09:00","close":"17:00"}]',
      },
      holidays: {
        type: "text",
        label: "Holidays and exceptions",
        description:
          "JSON list of closed days. Shape: [{\"date\": \"2026-12-25\", \"label\": \"Christmas Day\"}] or a range: [{\"from\": \"2026-12-20\", \"to\": \"2026-12-31\", \"label\": \"Holiday break\"}]. The label shows on the badge while closed.",
        default: "[]",
      },
      businessTimezone: {
        type: "select",
        label: "Time zone",
        description:
          "Used to decide whether the business is open right now. Leave empty to use the site's time zone.",
        default: "",
        options: [{ value: "", label: "Site default" }],
        optionsSource: "timezones",
      },
      openLabel: {
        type: "string",
        label: "Open badge text",
        description: "Custom text for the open badge. Leave empty for 'Open now'.",
        default: "",
      },
      closedLabel: {
        type: "string",
        label: "Closed badge text",
        description:
          "Custom text for the closed badge. Leave empty for 'Closed — opens <day time>' when the next opening is known.",
        default: "",
      },
      closedExtra: {
        type: "string",
        label: "Extra closed line",
        description: "Optional second line under the closed badge, e.g. 'We reply when we reopen.'",
        default: "",
      },
      openColor: {
        type: "string",
        label: "Open badge colour",
        description: "Hex colour for the open badge. Leave empty for green.",
        default: "",
      },
      closedColor: {
        type: "string",
        label: "Closed badge colour",
        description: "Hex colour for the closed badge. Leave empty for amber.",
        default: "",
      },
      departments: {
        type: "text",
        label: "Departments",
        description:
          "JSON list of routing chips. Shape: [{\"name\": \"Sales\", \"number\": \"+233201234567\", \"icon\": \"💼\"}]. With two or more, visitors pick who to chat with; the icon is optional.",
        default: "[]",
      },
      catalogUrl: {
        type: "string",
        label: "Catalog link",
        description:
          "Your WhatsApp Business catalog deep link (https://wa.me/c/...). Shows a 'Browse products' chip in the panel.",
        default: "",
      },
      leadFormEnabled: {
        type: "boolean",
        label: "Show a pre-chat lead form",
        description:
          "Asks for a name and consent before the chat opens. The details go into the visitor's own WhatsApp message — the plugin stores nothing.",
        default: false,
      },
      leadInterests: {
        type: "text",
        label: "Lead form interests",
        description: "One per line. Each becomes an option in the lead form's interest selector. Leave empty for no selector.",
        default: "",
      },
      leadConsentText: {
        type: "text",
        label: "Lead form consent line",
        description: "The sentence the visitor agrees to before continuing. Required while the lead form is on.",
        default: "I agree that my name and message will be sent to this business over WhatsApp.",
      },
      analyticsEnabled: {
        type: "boolean",
        label: "Count widget interactions",
        description:
          "Counts button opens, preset taps and sends as bare numbers. No IP address, phone number, visitor id or cookie is stored.",
        default: true,
      },
      analyticsPages: {
        type: "boolean",
        label: "Count which pages open the widget",
        description:
          "Adds the page path (never the query string) to the open counter, so you can see which pages start chats. Aggregate only — still no visitor data.",
        default: false,
      },
      nudgeEnabled: {
        type: "boolean",
        label: "Show a nudge bubble",
        description:
          "A small teaser appears near the button after a delay, inviting the visitor to chat. It never shows once they have opened the panel themselves.",
        default: false,
      },
      nudgeDelaySeconds: {
        type: "string",
        label: "Nudge delay (seconds)",
        description: "How long to wait before the teaser appears. 5 to 300 seconds.",
        default: "15",
      },
      nudgeText: {
        type: "text",
        label: "Nudge text",
        description: "The teaser line. Keep it short.",
        default: "👋 Need help? We're here to chat.",
      },
      nudgeMode: {
        type: "select",
        label: "Show the nudge",
        description:
          "Once per page load, or once per day — the day mode remembers the dismissal in the visitor's browser only (a single date flag, nothing else).",
        default: "once-per-load",
        options: [
          { value: "once-per-load", label: "Once per page load" },
          { value: "once-per-day", label: "Once per day" },
        ],
      },
      widgetLanguage: {
        type: "select",
        label: "Widget language",
        description:
          "Language of the widget's own text. 'Visitor's browser' uses each visitor's browser language when a translation exists.",
        default: "",
        options: [
          { value: "", label: "Site language" },
          { value: "auto", label: "Visitor's browser language" },
          { value: "en", label: "English" },
        ],
      },
      pageRules: {
        type: "text",
        label: "Page rules",
        description:
          "Optional JSON list. Each rule changes the welcome message and quick replies on matching pages. Shape: [{\"pattern\": \"/pricing\", \"welcome\": \"Want a quote?\", \"presets\": [\"Send pricing\"]}]. Patterns are anchored path globs matched in order: /pricing matches that page exactly, /pricing/* matches every page below it, and ? stands for one character.",
        default: "",
      },
      agentName: {
        type: "string",
        label: "Agent name",
        description: "Name shown in the chat header. Leave empty for the generic 'Chat with us'.",
        default: "",
      },
      agentRole: {
        type: "string",
        label: "Agent role",
        description: "Optional line under the agent name, e.g. 'Sales at Brayne'.",
        default: "",
      },
      agentPhoto: {
        type: "string",
        label: "Agent photo URL",
        description:
          "A same-site media path (/media/...) or https image URL for the chat header. Leave empty for the emoji avatar.",
        default: "",
      },
      utmPropagation: {
        type: "boolean",
        label: "Append UTM tags to messages",
        description:
          "Adds the page's utm_source, utm_medium and utm_campaign to the visitor's prefilled message, so you can see where a lead came from. Nothing is stored by the plugin.",
        default: false,
      },
    },
    assets: {
      dir: "public",
      scripts: ["widget.js"],
      styles: ["widget.css"],
    },
  },

  async activate(ctx: PluginContext) {
    ctx.logger.info("Brayne WhatsApp Connect activating");

    /**
     * The platform's own `<plugin id>.enabled` site switch: stored as a flag
     * limit of 0 it hides this plugin's admin pages and reports the feature as
     * off. `whenUnset: "on"` keeps the widget available until an operator or a
     * plan deliberately turns it off.
     */
    ctx.quotas.register({
      key: `${PLUGIN_ID}.enabled`,
      scope: "site",
      label: "WhatsApp Connect widget",
      unit: "flag",
      whenUnset: "on",
    });

    ctx.http.get("config", (req) => handleConfig(ctx, req));
    ctx.http.post("analytics", (req) => handleAnalytics(ctx, req), {
      csrf: false,
      rateLimit: { limit: 120, windowMs: 60_000, key: "analytics" },
    });
    ctx.http.get("admin-data", (req) => handleAdminData(ctx, req));
    ctx.http.put("admin-settings", (req) => handleAdminSettings(ctx, req));
    ctx.http.get("csv", (req) => handleCsv(ctx, req));

    /**
     * Stage 4.5: append this plugin's event names to the list administrators
     * can subscribe to, so a widget open/send can trigger their webhooks.
     * Removed automatically on deactivate, like every registration.
     */
    ctx.hooks.filter("webhook.eventTypes", (types) => [...types, ...WIDGET_EVENT_NAMES]);

    await ensureCounters(ctx);

    ctx.logger.info("Brayne WhatsApp Connect activated");
  },

  async deactivate(ctx: PluginContext) {
    /**
     * Routes, the quota meter and the site switch are owned by the host and
     * dropped automatically. Stored counters stay put so deactivating and
     * reactivating does not erase the numbers; `deleteData` is what clears them.
     */
    ctx.logger.info("Brayne WhatsApp Connect deactivated");
  },

  async deleteData(ctx: PluginContext) {
    await ctx.data.clear();
    ctx.logger.info("Brayne WhatsApp Connect deleteData (analytics counters cleared)");
  },
};

export default brayneWhatsAppConnect;
