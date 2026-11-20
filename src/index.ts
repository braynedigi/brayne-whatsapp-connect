import type { PluginContext, PluginHttpRequest, PluginModule } from "@justflows/sdk";
import {
  API_NAMESPACE,
  PLUGIN_ID,
  buildWidgetConfig,
  toBoolean,
  type RawSettings,
} from "./settings.js";
import {
  buildAdminSettings,
  validateAdminSettingsUpdate,
  type AdminDataPayload,
} from "./admin-api.js";
import { ensureCounters, incrementCounter, isAnalyticsEvent, readCounters } from "./counters.js";

/** Every key the widget reads, so one config request fills them in a single pass. */
const SETTING_KEYS = [
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
async function handleConfig(ctx: PluginContext) {
  const [raw, timezone] = await Promise.all([readRawSettings(ctx), siteTimeZone(ctx)]);
  const config = buildWidgetConfig(raw, timezone, new Date());
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

  const count = await incrementCounter(ctx, event);
  return { status: 200, body: { recorded: count !== null, count }, cors: true };
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
  const [raw, timezone, counters] = await Promise.all([
    readRawSettings(ctx),
    siteTimeZone(ctx),
    readCounters(ctx),
  ]);
  const payload: AdminDataPayload = {
    settings: buildAdminSettings(raw),
    widget: buildWidgetConfig(raw, timezone, new Date()),
    counters,
    siteTimeZone: timezone,
  };
  return { body: payload, headers: { "Cache-Control": "no-store" } };
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
    version: "0.1.0",
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
      welcomeMessage: {
        type: "text",
        label: "Welcome message",
        description: "Prefills the chat when a visitor opens the button.",
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
      businessOpenTime: {
        type: "string",
        label: "Opening time",
        description: "24-hour clock, HH:MM.",
        default: "09:00",
      },
      businessCloseTime: {
        type: "string",
        label: "Closing time",
        description: "24-hour clock, HH:MM.",
        default: "17:00",
      },
      businessDays: {
        type: "select",
        label: "Open days",
        default: "weekdays",
        options: [
          { value: "weekdays", label: "Monday to Friday" },
          { value: "mon-sat", label: "Monday to Saturday" },
          { value: "daily", label: "Every day" },
        ],
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
      analyticsEnabled: {
        type: "boolean",
        label: "Count widget interactions",
        description:
          "Counts button opens, preset taps and sends as bare numbers. No IP address, phone number, visitor id or cookie is stored.",
        default: true,
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

    ctx.http.get("config", () => handleConfig(ctx));
    ctx.http.post("analytics", (req) => handleAnalytics(ctx, req), {
      csrf: false,
      rateLimit: { limit: 120, windowMs: 60_000, key: "analytics" },
    });
    ctx.http.get("admin-data", (req) => handleAdminData(ctx, req));
    ctx.http.put("admin-settings", (req) => handleAdminSettings(ctx, req));

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
