// SPDX-License-Identifier: GPL-2.0-or-later

/*
 * WhatsApp Connect admin app.
 *
 * Runs inside the Justflows admin shell in a same-origin iframe. The shell
 * owns the sidebar and the page heading; this script builds the plugin's own
 * screens inside the frame:
 *
 *   Overview - live counters, a mirror of what visitors see, and banners for
 *              the two states that need attention (no number, widget off).
 *   Settings - the five screens (General, Message, Appearance, Business
 *              hours, Privacy) with the same rules the server enforces.
 *
 * Data comes from the plugin's own routes (`GET admin-data`, `PUT
 * admin-settings`); nothing is proxied through core. The host handshake is
 * the admin-bridge postMessage protocol (vendored below, matching
 * `@justflows/admin-bridge`): the host sends context (locale, theme, catalogs)
 * after `ready`, the frame reports its height and unsaved state.
 *
 * Every operator-entered value is rendered through textContent; the only
 * markup ever assigned as a string is the constant WhatsApp glyph below.
 */
"use strict";

(function () {
  /** Message envelope the plugin frame and the admin host exchange. */
  var PLUGIN_SOURCE = "justflows-admin-plugin";
  var HOST_SOURCE = "justflows-admin-host";

  /** Neutral API base for this plugin's `ctx.http` routes. */
  var API_BASE = "/api/brayne-whatsapp-connect";

  /**
   * English catalog. The manifest also ships it as `locales/en.json` (the host
   * serves that file and passes its URL as `context.catalogs.en`), which is
   * fetched at boot and layered over this map so a future translation only
   * needs another locale file. The copy here is the offline fallback.
   */
  var FALLBACK = {
    "app.name": "WhatsApp Connect",
    "app.backToOverview": "Back to overview",
    "overview.status.active": "Active",
    "overview.status.inactive": "Inactive",
    "overview.openSettings": "Open settings",
    "banner.noNumber.title": "No WhatsApp number yet",
    "banner.noNumber.body": "The widget stays hidden until you add a number.",
    "banner.noNumber.action": "Add your number",
    "banner.off.title": "The widget is turned off",
    "banner.off.body": "Visitors can't see the WhatsApp button right now.",
    "banner.off.action": "Turn it back on",
    "stats.widgetOpens": "Widget opens",
    "stats.presetTaps": "Preset taps",
    "stats.chatsStarted": "Chats started",
    "stats.countingOff": "Counting is off",
    "visitor.title": "How visitors see it",
    "visitor.number": "Number",
    "visitor.position": "Position",
    "visitor.size": "Size",
    "visitor.color": "Colour",
    "visitor.hours": "Business hours",
    "visitor.welcomeOpen": "Welcome while open",
    "visitor.welcomeClosed": "Welcome while closed",
    "visitor.notSet": "Not set",
    "hours.title": "Business hours",
    "hours.open": "Open now",
    "hours.closed": "Closed",
    "hours.off": "Always available",
    "hours.offHint": "Business hours are off, so the widget never shows a closed state.",
    "hours.schedule.title": "Weekly schedule",
    "hours.schedule.days": "Days",
    "hours.schedule.open": "Opening time",
    "hours.schedule.close": "Closing time",
    "hours.schedule.add": "Add window",
    "hours.schedule.remove": "Remove",
    "hours.schedule.invalid":
      "Each window needs at least one day and 24-hour HH:MM times. Use at most 14 windows.",
    "hours.schedule.hint":
      "Each window covers the days toggled on. A close time at or before the open time runs past midnight.",
    "hours.holidays.title": "Holidays and exceptions",
    "hours.holidays.from": "From",
    "hours.holidays.to": "To",
    "hours.holidays.label": "Label",
    "hours.holidays.labelPlaceholder": "e.g. Christmas Day",
    "hours.holidays.add": "Add holiday",
    "hours.holidays.remove": "Remove",
    "hours.holidays.invalid":
      "Use YYYY-MM-DD dates with the to date at or after the from date. At most 20 entries.",
    "hours.holidays.hint": "The business reads as closed on these days; the label shows on the badge.",
    "hours.label.tooLong": "Keep the badge text under 60 characters.",
    "hours.extra.tooLong": "Keep the extra line under 120 characters.",
    "field.openLabel.label": "Open badge text",
    "field.openLabel.hint": "Custom text for the open badge. Leave empty for 'Open now'.",
    "field.closedLabel.label": "Closed badge text",
    "field.closedLabel.hint": "Custom text for the closed badge. Leave empty for the automatic 'opens at' line.",
    "field.closedExtra.label": "Extra closed line",
    "field.closedExtra.hint": "Optional second line under the closed badge.",
    "field.openColor.label": "Open badge colour",
    "field.closedColor.label": "Closed badge colour",
    "field.badgeColor.hint": "Hex colour. Leave empty for the default.",
    "field.badgeColor.invalid": "Enter a hex colour like #12A150, or leave it empty.",
    "stats.perDepartment": "Chats started by department",
    "routing.departments": "Departments",
    "routing.name": "Department name",
    "routing.namePlaceholder": "Sales",
    "routing.icon": "Icon",
    "routing.number": "WhatsApp number",
    "routing.add": "Add department",
    "routing.remove": "Remove",
    "routing.invalid": "Each department needs a name and a valid number. Use at most 5.",
    "routing.hint": "With two or more departments, visitors pick who to chat with before sending.",
    "routing.catalog.label": "Catalog link",
    "routing.catalog.hint": "Your WhatsApp Business catalog deep link (https://wa.me/c/...). Shows a 'Browse products' chip.",
    "routing.catalog.invalid": "Use a catalog link that starts with https://wa.me/c/.",
    "field.leadFormEnabled.label": "Show a pre-chat lead form",
    "field.leadFormEnabled.hint": "Asks for a name and consent before the chat opens. The details go into the visitor's own WhatsApp message — the plugin stores nothing.",
    "field.leadInterests.label": "Lead form interests",
    "field.leadInterests.hint": "One per line. Each becomes an option in the lead form's interest selector. Leave empty for no selector.",
    "field.leadInterests.invalid": "Use at most 8 interests, each under 60 characters.",
    "field.leadConsentText.label": "Lead form consent line",
    "field.leadConsentText.hint": "The sentence the visitor agrees to before continuing.",
    "field.leadConsentText.invalid": "The consent line is required while the lead form is on, and stays under 300 characters.",
    "leads.privacy": "Nothing from the lead form is stored by the plugin: the name, interest and message ride inside the visitor's own WhatsApp message.",
    "analytics.trend": "Interactions per day",
    "analytics.event.open": "Opens",
    "analytics.event.preset": "Preset taps",
    "analytics.event.send": "Sends",
    "analytics.range14": "14 days",
    "analytics.range30": "30 days",
    "analytics.hours": "Busiest hours",
    "analytics.hoursHint": "Opens and sends by hour of day, in the site's time zone.",
    "analytics.pages": "Top pages",
    "analytics.pagesOff": "Turn on page counting in Privacy to see which pages open the widget.",
    "analytics.pagesEmpty": "No page opens recorded in this range yet.",
    "analytics.export": "Export CSV",
    "field.analyticsPages.label": "Count which pages open the widget",
    "field.analyticsPages.hint": "Adds the page path (never the query string) to the open counter, so you can see which pages start chats. Aggregate only — still no visitor data.",
    "nudge.title": "Nudge bubble",
    "field.nudgeEnabled.label": "Show a nudge bubble",
    "field.nudgeEnabled.hint": "A small teaser appears near the button after a delay, inviting the visitor to chat. It never shows once they have opened the panel themselves.",
    "field.nudgeText.label": "Nudge text",
    "field.nudgeText.hint": "The teaser line. Keep it short.",
    "field.nudgeText.invalid": "Keep the nudge text under 120 characters.",
    "field.nudgeDelaySeconds.label": "Nudge delay (seconds)",
    "field.nudgeDelaySeconds.hint": "How long to wait before the teaser appears. 5 to 300 seconds.",
    "field.nudgeDelaySeconds.invalid": "Use a whole number of seconds, from 5 to 300.",
    "field.nudgeMode.label": "Show the nudge",
    "field.nudgeMode.hint": "Once per day remembers the dismissal with a single date flag in the visitor's browser.",
    "option.nudge.once-per-load": "Once per page load",
    "option.nudge.once-per-day": "Once per day",
    "settings.title": "Settings",
    "settings.save": "Save changes",
    "settings.saving": "Saving...",
    "settings.saved": "Settings saved",
    "settings.saveFailed": "Couldn't save settings - fix the highlighted field.",
    "settings.unsaved": "Unsaved changes",
    "tab.general": "General",
    "tab.message": "Message",
    "tab.appearance": "Appearance",
    "tab.identity": "Identity",
    "tab.hours": "Business hours",
    "tab.routing": "Routing",
    "tab.leads": "Leads",
    "tab.analytics": "Analytics",
    "tab.privacy": "Privacy",
    "field.enabled.label": "Show the WhatsApp button",
    "field.enabled.hint": "Turn the floating contact button off without uninstalling the plugin.",
    "field.whatsappNumber.label": "WhatsApp number",
    "field.whatsappNumber.hint":
      "International format without spaces or brackets, e.g. 15551234567 or +233201234567. Leave empty to hide the button.",
    "field.whatsappNumber.invalid":
      "Enter digits only, 7 to 15 characters, optionally starting with +.",
    "field.welcomeMessageOpen.label": "Welcome while open",
    "field.welcomeMessageOpen.hint": "Prefills the chat when a visitor opens the button during business hours.",
    "field.welcomeMessageClosed.label": "Welcome while closed",
    "field.welcomeMessageClosed.hint":
      "Prefills the chat when the business is closed. Falls back to the open message until you set it.",
    "field.presetMessages.label": "Preset messages",
    "field.presetMessages.hint":
      "One per line. Each becomes a tappable quick reply above the message box.",
    "field.presetMessages.invalid": "Use at most 6 preset messages, each under 200 characters.",
    "field.buttonPosition.label": "Button position",
    "field.buttonPosition.hint":
      "Corner the button sits in. It moves above the browser's own UI on small screens.",
    "field.buttonSize.label": "Button size",
    "field.buttonColor.label": "Button colour",
    "field.buttonColor.hint": "Any hex colour. Leave empty for WhatsApp green (#25D366).",
    "field.buttonColor.invalid":
      "Enter a hex colour like #25D366, or leave it empty for WhatsApp green.",
    "field.businessHoursEnabled.label": "Show business hours",
    "field.businessHoursEnabled.hint":
      "Shows an Open / Closed badge and, when closed, still lets visitors leave a message.",
    "field.businessDays.label": "Open days",
    "field.businessOpenTime.label": "Opening time",
    "field.businessCloseTime.label": "Closing time",
    "field.clock.hint": "24-hour clock, HH:MM.",
    "field.clock.invalid": "Use the 24-hour clock, HH:MM, for example 09:00.",
    "field.businessTimezone.label": "Time zone",
    "field.businessTimezone.hint":
      "Used to decide whether the business is open right now. Leave empty to use the site's time zone.",
    "field.businessTimezone.siteDefault": "Site default",
    "field.analyticsEnabled.label": "Count widget interactions",
    "field.analyticsEnabled.hint":
      "Counts button opens, preset taps and sends as bare numbers. No IP address, phone number, visitor id or cookie is stored.",
    "field.widgetLanguage.label": "Widget language",
    "field.widgetLanguage.hint":
      "Language of the widget's own text. 'Visitor's browser' uses each visitor's browser language when a translation exists.",
    "option.language.site": "Site language",
    "option.language.auto": "Visitor's browser language",
    "option.language.en": "English",
    "field.pageRules.label": "Page rules",
    "field.pageRules.hint":
      "Optional JSON list. Each rule changes the welcome message and quick replies on matching pages. Patterns are anchored path globs matched in order: /pricing matches that page exactly, /pricing/* matches every page below it, and ? stands for one character.",
    "field.pageRules.placeholder":
      '[{"pattern": "/pricing", "welcome": "Want a quote?", "presets": ["Send me your pricing"]}]',
    "field.pageRules.invalid":
      "Page rules must be a JSON array of at most 10 rules; each pattern starts with / and each rule needs a welcome message or presets.",
    "field.pageRules.testLabel": "Test a path",
    "field.pageRules.testPlaceholder": "/pricing",
    "field.pageRules.testButton": "Preview",
    "field.pageRules.noMatch": "No rule matches this path.",
    "field.agentName.label": "Agent name",
    "field.agentName.hint": "Name shown in the chat header. Leave empty for the generic 'Chat with us'.",
    "field.agentName.placeholder": "Chat with us",
    "field.agentRole.label": "Agent role",
    "field.agentRole.hint": "Optional line under the agent name, e.g. 'Sales at Brayne'.",
    "field.agentPhoto.label": "Agent photo URL",
    "field.agentPhoto.hint":
      "A same-site media path (/media/...) or https image URL for the chat header. Leave empty for the emoji avatar.",
    "field.agentPhoto.invalid": "Use a same-site path like /media/logo.png or an https image URL.",
    "field.agentName.invalid": "Keep the name under 60 characters.",
    "field.agentRole.invalid": "Keep the role under 60 characters.",
    "identity.preview": "How the chat header looks",
    "identity.mediaPick": "Select from media library",
    "identity.mediaHint": "Pick an image from the site's media library, or paste a URL below.",
    "identity.mediaClose": "Close",
    "identity.mediaEmpty": "No images yet. Upload some in Media first.",
    "identity.mediaError": "Couldn't load the media library.",
    "field.utmPropagation.label": "Append UTM tags to messages",
    "field.utmPropagation.hint":
      "Adds the page's utm_source, utm_medium and utm_campaign to the visitor's prefilled message, so you can see where a lead came from. Nothing is stored by the plugin.",
    "privacy.store.title": "What this plugin stores",
    "privacy.store.counters":
      "Aggregate counters only: widget opens, preset taps, and chats started.",
    "privacy.store.noPersonal":
      "No IP address, phone number, visitor id, or cookie is collected by this plugin.",
    "privacy.store.chats": "Chats happen on WhatsApp's own servers once a visitor taps through.",
    "privacy.store.delete": "Deleting the plugin's data clears every counter.",
    "option.position.bottom-right": "Bottom right",
    "option.position.bottom-left": "Bottom left",
    "option.size.small": "Small (48px)",
    "option.size.medium": "Medium (56px)",
    "option.size.large": "Large (64px)",
    "option.days.weekdays": "Monday to Friday",
    "option.days.mon-sat": "Monday to Saturday",
    "option.days.daily": "Every day",
    "color.whatsappGreen": "WhatsApp green",
    "color.deepIndigo": "Deep indigo",
    "color.ink": "Ink",
    "color.snow": "Snow",
    "color.custom": "Custom",
    "error.loadFailed": "Couldn't load the WhatsApp Connect admin data.",
    "error.forbidden": "Your account can't manage these settings.",
    noscript: "This screen needs JavaScript to run.",
  };

  /**
   * The WhatsApp glyph drawn inside every preview button. Built with the DOM
   * so no markup string is ever assigned (the widget's own audit rule, and
   * the platform checker's JF-S004); the path data is a constant.
   */
  function glyphNode() {
    var svgNamespace = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var path = document.createElementNS(svgNamespace, "path");
    path.setAttribute(
      "d",
      "M16 3a13 13 0 0 0-11 19.8L3 29l6.4-1.9A13 13 0 1 0 16 3zm0 2a11 11 0 1 1-5.6 20.5l-.4-.2-3.5 1 1-3.4-.2-.4A11 11 0 0 1 16 5zm-4.6 5.3c-.2 0-.5 0-.7.3-.2.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 2.9 4.4 3.9 2.2.8 2.6.7 3.1.6.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.7.9c-.1.2-.3.2-.5.1-.7-.3-1.5-.7-2.3-1.4-.6-.6-1-1.2-1.2-1.5-.1-.2 0-.4.1-.5l.5-.6c.1-.2.1-.3 0-.5l-.7-1.7c-.2-.4-.3-.4-.5-.4h-.3z",
    );
    svg.appendChild(path);
    return svg;
  }

  var TABS = [
    { id: "general", labelKey: "tab.general" },
    { id: "message", labelKey: "tab.message" },
    { id: "appearance", labelKey: "tab.appearance" },
    { id: "identity", labelKey: "tab.identity" },
    { id: "hours", labelKey: "tab.hours" },
    { id: "routing", labelKey: "tab.routing" },
    { id: "leads", labelKey: "tab.leads" },
    { id: "analytics", labelKey: "tab.analytics" },
    { id: "privacy", labelKey: "tab.privacy" },
  ];

  var SIZE_SCALE = { small: 14, medium: 17, large: 20 };
  var PRESET_COLORS = [
    { key: "color.whatsappGreen", value: "#25d366" },
    { key: "color.deepIndigo", value: "#4f46e5" },
    { key: "color.ink", value: "#0f172a" },
    { key: "color.snow", value: "#ffffff" },
  ];

  /** The frame's state: one object, re-rendered on every deliberate change. */
  var state = {
    catalog: Object.assign({}, FALLBACK),
    theme: "",
    locale: "en",
    data: null,
    view: "overview",
    tab: "general",
    form: {},
    dirty: false,
    saving: false,
    saved: false,
    loadError: "",
    saveError: "",
    fieldErrors: {},
    toastTimer: 0,
    mediaOpen: false,
    mediaItems: [],
    mediaError: "",
    scheduleWindows: [],
    holidayEntries: [],
    departmentEntries: [],
    analyticsRange: 14,
  };

  /** Look a label up in the loaded catalog, falling back to English. */
  function t(key) {
    var value = state.catalog[key];
    return typeof value === "string" && value ? value : FALLBACK[key] || key;
  }

  /* ------------------------------------------------------------ admin bridge */

  /**
   * Minimal client for the host's admin-bridge postMessage protocol (the same
   * envelope `@justflows/admin-bridge` implements; vendored so this static
   * app needs no bundler). Only the messages this app uses are included.
   */
  function createAdminBridge() {
    var context = null;
    var contextListeners = [];
    var resizeObserver = null;
    var frame = 0;

    function post(message) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          Object.assign({ source: PLUGIN_SOURCE }, message),
          window.location.origin,
        );
      }
    }

    function currentHeight() {
      var el = document.documentElement;
      var body = document.body;
      return Math.max(
        Math.ceil(el.getBoundingClientRect().height),
        el.scrollHeight,
        body ? body.scrollHeight : 0,
      );
    }

    function onMessage(event) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      var data = event.data;
      if (!data || data.source !== HOST_SOURCE) return;
      if (data.type === "context" && data.context && typeof data.context === "object") {
        context = data.context;
        contextListeners.forEach(function (listener) {
          listener(context);
        });
      }
    }

    window.addEventListener("message", onMessage);

    return {
      ready: function () {
        post({ type: "ready" });
      },
      onContext: function (listener) {
        contextListeners.push(listener);
        if (context) listener(context);
      },
      navigate: function (path) {
        if (typeof path === "string" && path) post({ type: "navigate", path: path });
      },
      reportDirty: function (dirty) {
        post({ type: "dirty", dirty: dirty === true });
      },
      autoResize: function () {
        var report = function () {
          var ticket = ++frame;
          if (frame) cancelAnimationFrame(0);
          requestAnimationFrame(function () {
            if (ticket !== frame) return;
            post({ type: "resize", height: currentHeight() });
          });
        };
        report();
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(report);
          resizeObserver.observe(document.documentElement);
          if (document.body && document.body !== document.documentElement) {
            resizeObserver.observe(document.body);
          }
        }
        window.addEventListener("load", report);
      },
      destroy: function () {
        window.removeEventListener("message", onMessage);
        if (resizeObserver) resizeObserver.disconnect();
        contextListeners.length = 0;
      },
    };
  }

  var bridge = createAdminBridge();

  /* --------------------------------------------------------------- helpers */

  /** Create an element with attributes and children (text or nodes). */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (name) {
        var value = attrs[name];
        if (value === null || value === undefined || value === false) return;
        /**
         * Event handlers must be assigned as properties. Stringifying a
         * function into an attribute would make the browser parse its source
         * as an inline handler body, where `function (event) { ... }` is an
         * anonymous function statement - a SyntaxError on first dispatch,
         * and a dead button.
         */
        if (name.slice(0, 2) === "on" && typeof value === "function") {
          el[name] = value;
          return;
        }
        if (name === "class") el.className = value;
        else if (name === "for") el.setAttribute("for", value);
        else if (name === "text") el.textContent = String(value);
        else el.setAttribute(name, value === true ? "" : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return el;
  }

  /** The frame preview button: a green circle with the WhatsApp glyph. */
  function fabNode(sizeClass, position, color) {
    var fab = h("span", { class: "jwa-preview__fab " + sizeClass });
    fab.appendChild(glyphNode());
    fab.style.width = SIZE_SCALE[sizeClass] + "px";
    fab.style.height = SIZE_SCALE[sizeClass] + "px";
    fab.style.background = color;
    fab.style.bottom = "10px";
    fab.style[position === "bottom-left" ? "left" : "right"] = "10px";
    return fab;
  }

  function readCsrfCookie() {
    var match = document.cookie.match(/(?:^|; )jf_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /** Same-origin JSON fetch; the frame shares the operator's session cookies. */
  function fetchJson(path, options) {
    return fetch(
      path,
      Object.assign({ credentials: "same-origin", cache: "no-store" }, options),
    ).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
    });
  }

  /** Only digits (and an optional leading +) survive; mirrors the server rule. */
  function numberLooksValid(value) {
    if (!value) return true;
    var digits = String(value)
      .replace(/[\s().-]/g, "")
      .replace(/^\+/, "");
    return /^\d{7,15}$/.test(digits);
  }

  function hexLooksValid(value) {
    if (!value) return true;
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
  }

  function clockLooksValid(value) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim());
  }

  function presetsLookValid(value) {
    var lines = String(value)
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
    return (
      lines.length <= 6 &&
      lines.every(function (line) {
        return line.length <= 200;
      })
    );
  }

  /** The same rule shape the server accepts, for instant feedback. */
  function pageRulesLookValid(value) {
    var text = String(value || "");
    if (!text.trim()) return true;
    if (text.length > 5000) return false;
    var parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return false;
    }
    if (!Array.isArray(parsed) || parsed.length > 10) return false;
    return parsed.every(function (rule) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
      if (typeof rule.pattern !== "string" || !/^\/[A-Za-z0-9_\-/.*?]*$/.test(rule.pattern.trim())) {
        return false;
      }
      if (rule.welcome !== undefined && (typeof rule.welcome !== "string" || rule.welcome.length > 500)) {
        return false;
      }
      if (rule.presets !== undefined) {
        if (
          !Array.isArray(rule.presets) ||
          rule.presets.length > 6 ||
          rule.presets.some(function (preset) {
            return typeof preset !== "string" || preset.length > 200;
          })
        ) {
          return false;
        }
      }
      return Boolean(rule.welcome) || (Array.isArray(rule.presets) && rule.presets.length > 0);
    });
  }

  function agentPhotoLooksValid(value) {
    var text = String(value || "").trim();
    if (!text) return true;
    if (text.length > 300) return false;
    if (!/^(https:\/\/|\/)/.test(text)) return false;
    return !/[\s"'<>]/.test(text);
  }

  function formatNumber(value) {
    if (!value) return t("visitor.notSet");
    return "+" + String(value).replace(/^\+/, "");
  }

  /* ------------------------------------------------------------- data load */

  function loadData() {
    return fetchJson(API_BASE + "/admin-data").then(function (result) {
      if (!result.ok) {
        state.loadError =
          result.status === 403
            ? t("error.forbidden")
            : result.body && result.body.error
              ? result.body.error
              : t("error.loadFailed");
        state.data = null;
        return;
      }
      state.loadError = "";
      state.data = result.body;
      state.form = Object.assign({}, result.body.settings);
      syncEditorState();
      parseDepartmentEntries();
    });
  }

  /* -------------------------------------------------------------- rendering */

  function render() {
    var root = document.getElementById("app");
    while (root.firstChild) root.removeChild(root.firstChild);
    if (state.loadError && !state.data) {
      root.appendChild(
        h("div", { class: "jwa-banner jwa-banner--error", role: "alert" }, [
          h("div", { class: "jwa-banner__text" }, [
            h("p", { class: "jwa-banner__title", text: state.loadError }),
          ]),
        ]),
      );
      return;
    }
    if (!state.data) {
      root.appendChild(h("div", { class: "jwa-skeleton", "aria-hidden": "true" }, []));
      return;
    }
    root.appendChild(state.view === "settings" ? renderSettings() : renderOverview());
    if (state.saved) {
      var toast = h("div", { class: "jwa-toast", role: "status" }, [
        h("span", { class: "jwa-dot" }),
        t("settings.saved"),
      ]);
      root.appendChild(toast);
      if (state.toastTimer) window.clearTimeout(state.toastTimer);
      state.toastTimer = window.setTimeout(function () {
        state.saved = false;
        render();
      }, 3200);
    }
  }

  /* ------------------------------------------------------------- overview */

  function renderOverview() {
    var data = state.data;
    var widget = data.widget;
    var settings = data.settings;
    var counting = settings.analyticsEnabled !== false;
    var wrap = h("div", { class: "jwa-view" }, []);

    wrap.appendChild(
      h("header", { class: "jwa-head" }, [
        h("div", {}, [
          h("h1", { text: t("app.name") }),
          h("p", { class: "jwa-id", text: "justflows.brayne-whatsapp-connect" }),
        ]),
        h("div", { class: "jwa-head-actions" }, [
          h("span", { class: "jwa-pill" + (settings.enabled ? "" : " jwa-pill--muted") }, [
            h("span", { class: "jwa-dot" }),
            t(settings.enabled ? "overview.status.active" : "overview.status.inactive"),
          ]),
          h(
            "button",
            {
              class: "jwa-btn jwa-btn--primary",
              type: "button",
              onclick: function () {
                openSettings("general");
              },
            },
            [t("overview.openSettings")],
          ),
        ]),
      ]),
    );

    if (settings.enabled && !widget.number) {
      wrap.appendChild(
        bannerNode("banner.noNumber", function () {
          openSettings("general", "whatsappNumber");
        }),
      );
    } else if (!settings.enabled) {
      wrap.appendChild(
        bannerNode("banner.off", function () {
          openSettings("general", "enabled");
        }),
      );
    }

    var stat = function (labelKey, value) {
      return h("div", { class: "jwa-stat" }, [
        h("div", { class: "jwa-stat__label", text: t(labelKey) }),
        h("div", {
          class: "jwa-stat__value" + (counting ? "" : " jwa-stat__value--muted"),
          text: counting ? String(value) : "-",
        }),
      ]);
    };

    wrap.appendChild(
      h("div", { class: "jwa-stats" }, [
        stat("stats.widgetOpens", data.counters.open || 0),
        stat("stats.presetTaps", data.counters.preset || 0),
        stat("stats.chatsStarted", data.counters.send || 0),
        counting ? null : h("p", { class: "jwa-stat__note", text: t("stats.countingOff") }),
      ]),
    );

    if (widget.departments && widget.departments.length >= 2) {
      wrap.appendChild(h("p", { class: "jwa-stat__note", text: t("stats.perDepartment") }));
      var deptStats = h("div", { class: "jwa-stats" }, []);
      widget.departments.forEach(function (dept, index) {
        deptStats.appendChild(stat(dept.name, data.counters["send:" + index] || 0));
      });
      wrap.appendChild(deptStats);
    }

    var defs = h("dl", { class: "jwa-defs" }, []);
    defs.appendChild(h("dt", { text: t("visitor.number") }));
    defs.appendChild(h("dd", { text: formatNumber(widget.number) }));
    defs.appendChild(h("dt", { text: t("visitor.position") }));
    defs.appendChild(h("dd", { text: t("option.position." + widget.button.position) }));
    defs.appendChild(h("dt", { text: t("visitor.size") }));
    defs.appendChild(h("dd", { text: t("option.size." + widget.button.size) }));
    defs.appendChild(h("dt", { text: t("visitor.color") }));
    defs.appendChild(
      h("dd", {}, [h("span", { class: "jwa-swatch" }), widget.button.color.toUpperCase()]),
    );
    var colorDot = defs.lastChild.firstChild;
    colorDot.style.background = widget.button.color;
    defs.appendChild(h("dt", { text: t("visitor.hours") }));
    defs.appendChild(h("dd", { text: hoursSummary(widget) }));
    defs.appendChild(h("dt", { text: t("visitor.welcomeOpen") }));
    defs.appendChild(h("dd", { text: widget.greeting ? widget.greeting.open : "" }));
    if (widget.hours.enabled) {
      defs.appendChild(h("dt", { text: t("visitor.welcomeClosed") }));
      defs.appendChild(h("dd", { text: widget.greeting ? widget.greeting.closed : "" }));
    }
    if (widget.agent && widget.agent.name) {
      defs.appendChild(h("dt", { text: t("field.agentName.label") }));
      defs.appendChild(
        h("dd", { text: widget.agent.role ? widget.agent.name + " — " + widget.agent.role : widget.agent.name }),
      );
    }

    var preview = h("div", { class: "jwa-preview" }, [
      fabNode(widget.button.size, widget.button.position, widget.button.color),
    ]);

    wrap.appendChild(
      h("section", { class: "jwa-card" }, [
        h("div", { class: "jwa-card__head" }, [
          h("h2", { class: "jwa-card__title", text: t("visitor.title") }),
        ]),
        h("div", { class: "jwa-card__body" }, [preview, defs]),
      ]),
    );

    if (widget.hours.enabled) {
      wrap.appendChild(
        h("section", { class: "jwa-card" }, [
          h("div", { class: "jwa-card__head" }, [
            h("h2", { class: "jwa-card__title", text: t("hours.title") }),
          ]),
          h("div", { class: "jwa-card__body" }, [
            h(
              "span",
              {
                class:
                  "jwa-hours-state " +
                  (widget.hours.openNow ? "jwa-hours-state--open" : "jwa-hours-state--closed"),
              },
              [
                widget.hours.openNow
                  ? t("hours.open")
                  : widget.hours.holidayLabel || t("hours.closed"),
              ],
            ),
            h("p", { class: "jwa-field__hint", text: hoursSummary(widget) }),
          ]),
        ]),
      );
    }

    return wrap;
  }

  function hoursSummary(widget) {
    if (!widget.hours.enabled) return t("hours.off");
    return widget.hours.summary || "";
  }

  function bannerNode(prefix, action) {
    return h("div", { class: "jwa-banner", role: "alert" }, [
      h("div", { class: "jwa-banner__text" }, [
        h("p", { class: "jwa-banner__title", text: t(prefix + ".title") }),
        h("p", { class: "jwa-banner__body", text: t(prefix + ".body") }),
      ]),
      h("button", { class: "jwa-btn jwa-btn--primary", type: "button", onclick: action }, [
        t(prefix + ".action"),
      ]),
    ]);
  }

  /* ------------------------------------------------------------- settings */

  function openSettings(tab, focusField) {
    state.view = "settings";
    state.tab = TABS.some(function (entry) {
      return entry.id === tab;
    })
      ? tab
      : "general";
    state.saveError = "";
    state.fieldErrors = {};
    render();
    if (focusField) {
      var field = document.getElementById("jwa-field-" + focusField);
      if (field) field.focus();
    }
    var selected = document.querySelector('.jwa-tab[aria-selected="true"]');
    if (selected && !focusField) selected.focus();
  }

  /** After a tab re-render, put focus back on the tab the operator chose. */
  function focusTab(id) {
    var tab = document.getElementById("jwa-tab-" + id);
    if (tab) tab.focus();
  }

  function renderSettings() {
    var wrap = h("div", { class: "jwa-view" }, []);
    wrap.appendChild(
      h("header", { class: "jwa-head" }, [
        h("div", {}, [
          h("h1", { text: t("settings.title") }),
          h("p", { class: "jwa-id", text: t("app.name") }),
        ]),
        h("div", { class: "jwa-head-actions" }, [
          state.dirty
            ? h("span", { class: "jwa-pill jwa-pill--muted", text: t("settings.unsaved") })
            : null,
          h(
            "button",
            {
              class: "jwa-btn jwa-btn--ghost",
              type: "button",
              onclick: function () {
                state.view = "overview";
                state.fieldErrors = {};
                state.saveError = "";
                render();
              },
            },
            [t("app.backToOverview")],
          ),
          h(
            "button",
            {
              id: "jwa-save",
              class: "jwa-btn jwa-btn--primary",
              type: "button",
              disabled: state.saving || !state.dirty,
              onclick: save,
            },
            [t(state.saving ? "settings.saving" : "settings.save")],
          ),
        ]),
      ]),
    );

    if (state.saveError) {
      wrap.appendChild(
        h("div", { class: "jwa-banner jwa-banner--error", role: "alert" }, [
          h("div", { class: "jwa-banner__text" }, [
            h("p", { class: "jwa-banner__title", text: state.saveError }),
          ]),
        ]),
      );
    }

    var tablist = h(
      "div",
      { class: "jwa-tabs", role: "tablist", "aria-label": t("settings.title") },
      [],
    );
    TABS.forEach(function (entry) {
      tablist.appendChild(
        h(
          "button",
          {
            class: "jwa-tab",
            type: "button",
            role: "tab",
            id: "jwa-tab-" + entry.id,
            "aria-selected": String(state.tab === entry.id),
            "aria-controls": "jwa-panel-" + entry.id,
            tabindex: state.tab === entry.id ? "0" : "-1",
            onclick: function () {
              state.tab = entry.id;
              render();
              focusTab(entry.id);
            },
            onkeydown: function (event) {
              var offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!offset) return;
              event.preventDefault();
              var index = TABS.findIndex(function (item) {
                return item.id === state.tab;
              });
              var next = TABS[(index + offset + TABS.length) % TABS.length];
              state.tab = next.id;
              render();
              focusTab(next.id);
            },
          },
          [t(entry.labelKey)],
        ),
      );
    });
    wrap.appendChild(tablist);

    var panel = h(
      "div",
      { role: "tabpanel", id: "jwa-panel-" + state.tab, "aria-labelledby": "jwa-tab-" + state.tab },
      [],
    );
    var tabRenderers = {
      general: renderTabGeneral,
      message: renderTabMessage,
      appearance: renderTabAppearance,
      identity: renderTabIdentity,
      hours: renderTabHours,
      routing: renderTabRouting,
      leads: renderTabLeads,
      analytics: renderTabAnalytics,
      privacy: renderTabPrivacy,
    };
    panel.appendChild(tabRenderers[state.tab]());
    wrap.appendChild(panel);

    return wrap;
  }

  function setFormValue(key, value) {
    if (state.form[key] === value) return;
    state.form[key] = value;
    if (!state.dirty) {
      state.dirty = true;
      bridge.reportDirty(true);
    }
    if (state.fieldErrors[key]) {
      delete state.fieldErrors[key];
      render();
      return;
    }
    /** Input events must not re-render: focus would jump mid-typing. */
    var save = document.getElementById("jwa-save");
    if (save) {
      save.disabled = state.saving || !state.dirty;
    }
    var head = document.querySelector(".jwa-head-actions");
    if (head && state.dirty && !document.getElementById("jwa-unsaved")) {
      var note = h("span", {
        class: "jwa-pill jwa-pill--muted",
        id: "jwa-unsaved",
        text: t("settings.unsaved"),
      });
      head.insertBefore(note, head.firstChild);
    }
  }

  function fieldError(key, messageKey) {
    var message = state.fieldErrors[key];
    if (!message) return null;
    return h("p", {
      class: "jwa-field__error",
      role: "alert",
      text: messageKey ? t(messageKey) : message,
    });
  }

  function checkrowNode(key, labelKey, hintKey) {
    return h("label", { class: "jwa-checkrow" }, [
      h("input", {
        id: "jwa-field-" + key,
        type: "checkbox",
        checked: state.form[key] === true,
        onchange: function (event) {
          setFormValue(key, event.target.checked);
        },
      }),
      h("span", { class: "jwa-checkrow__text" }, [
        h("span", { class: "jwa-checkrow__label", text: t(labelKey) }),
        h("span", { class: "jwa-checkrow__meta", text: t(hintKey) }),
      ]),
    ]);
  }

  function labeledInput(key, labelKey, hintKey, options) {
    options = options || {};
    var input = h(options.multiline ? "textarea" : "input", {
      id: "jwa-field-" + key,
      class: "jwa-input",
      "aria-invalid": state.fieldErrors[key] ? "true" : null,
      placeholder: options.placeholder || "",
      rows: options.rows,
      text: options.multiline ? String(state.form[key] || "") : null,
      value: options.multiline ? null : String(state.form[key] ?? ""),
      oninput: function (event) {
        setFormValue(key, event.target.value);
      },
    });
    if (options.multiline && typeof input.value !== "undefined") {
      input.value = String(state.form[key] || "");
    }
    return h("div", { class: "jwa-field" }, [
      h("label", { class: "jwa-field__label", for: "jwa-field-" + key, text: t(labelKey) }),
      input,
      fieldError(key),
      h("p", { class: "jwa-field__hint", text: t(hintKey) }),
    ]);
  }

  function renderTabGeneral() {
    var languages = h("select", {
      id: "jwa-field-widgetLanguage",
      class: "jwa-input",
      onchange: function (event) {
        setFormValue("widgetLanguage", event.target.value);
      },
    });
    [
      ["", "option.language.site"],
      ["auto", "option.language.auto"],
      ["en", "option.language.en"],
    ].forEach(function (entry) {
      languages.appendChild(
        h("option", { value: entry[0], selected: state.form.widgetLanguage === entry[0] ? true : null }, [
          t(entry[1]),
        ]),
      );
    });

    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.general") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        checkrowNode("enabled", "field.enabled.label", "field.enabled.hint"),
        labeledInput("whatsappNumber", "field.whatsappNumber.label", "field.whatsappNumber.hint", {
          placeholder: "+233201234567",
        }),
        h("div", { class: "jwa-field" }, [
          h("label", {
            class: "jwa-field__label",
            for: "jwa-field-widgetLanguage",
            text: t("field.widgetLanguage.label"),
          }),
          languages,
          h("p", { class: "jwa-field__hint", text: t("field.widgetLanguage.hint") }),
        ]),
      ]),
    ]);
  }

  function renderTabMessage() {
    var nudgeMode = h("select", {
      id: "jwa-field-nudgeMode",
      class: "jwa-input",
      onchange: function (event) {
        setFormValue("nudgeMode", event.target.value);
      },
    });
    [
      ["once-per-load", "option.nudge.once-per-load"],
      ["once-per-day", "option.nudge.once-per-day"],
    ].forEach(function (entry) {
      nudgeMode.appendChild(
        h("option", { value: entry[0], selected: state.form.nudgeMode === entry[0] ? true : null }, [
          t(entry[1]),
        ]),
      );
    });

    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.message") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        labeledInput(
          "welcomeMessageOpen",
          "field.welcomeMessageOpen.label",
          "field.welcomeMessageOpen.hint",
          { multiline: true, rows: 3 },
        ),
        labeledInput(
          "welcomeMessageClosed",
          "field.welcomeMessageClosed.label",
          "field.welcomeMessageClosed.hint",
          { multiline: true, rows: 3 },
        ),
        labeledInput("presetMessages", "field.presetMessages.label", "field.presetMessages.hint", {
          multiline: true,
          rows: 5,
          placeholder: "I'd like a quote",
        }),
        pageRulesField(),
        h("div", { class: "jwa-card__head" }, [
          h("h2", { class: "jwa-card__title", text: t("nudge.title") }),
        ]),
        checkrowNode("nudgeEnabled", "field.nudgeEnabled.label", "field.nudgeEnabled.hint"),
        labeledInput("nudgeText", "field.nudgeText.label", "field.nudgeText.hint"),
        h("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px" }, [
          labeledInput(
            "nudgeDelaySeconds",
            "field.nudgeDelaySeconds.label",
            "field.nudgeDelaySeconds.hint",
            { placeholder: "15" },
          ),
          h("div", { class: "jwa-field" }, [
            h("label", {
              class: "jwa-field__label",
              for: "jwa-field-nudgeMode",
              text: t("field.nudgeMode.label"),
            }),
            nudgeMode,
            h("p", { class: "jwa-field__hint", text: t("field.nudgeMode.hint") }),
          ]),
        ]),
        fieldError("nudgeDelaySeconds", "field.nudgeDelaySeconds.invalid"),
      ]),
    ]);
  }

  /** Same matcher the server applies, so the tester previews the real result. */
  function clientRuleMatch(rules, path) {
    for (var index = 0; index < rules.length; index += 1) {
      var rule = rules[index];
      if (!rule || typeof rule !== "object" || typeof rule.pattern !== "string") continue;
      var escaped = rule.pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      var regex = new RegExp("^" + escaped + "$");
      if (regex.test(path)) return rule;
    }
    return null;
  }

  function pageRulesField() {
    var textarea = h("textarea", {
      id: "jwa-field-pageRules",
      class: "jwa-input",
      "aria-invalid": state.fieldErrors["pageRules"] ? "true" : null,
      rows: 6,
      placeholder: t("field.pageRules.placeholder"),
      text: String(state.form.pageRules || ""),
      oninput: function (event) {
        setFormValue("pageRules", event.target.value);
      },
    });
    var testInput = h("input", {
      id: "jwa-field-pageRulesTest",
      class: "jwa-input",
      placeholder: t("field.pageRules.testPlaceholder"),
      value: "/",
    });
    var result = h("p", { class: "jwa-rule-result" }, []);
    var testButton = h(
      "button",
      {
        class: "jwa-btn jwa-btn--ghost",
        type: "button",
        onclick: function () {
          var text = String(state.form.pageRules || "");
          var parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch (err) {
            parsed = null;
          }
          var path = testInput.value || "/";
          var matched = Array.isArray(parsed) ? clientRuleMatch(parsed, path) : null;
          result.textContent = matched
            ? t("field.pageRules.label") + ": " + matched.pattern
            : t("field.pageRules.noMatch");
        },
      },
      [t("field.pageRules.testButton")],
    );

    return h("div", { class: "jwa-field" }, [
      h("label", {
        class: "jwa-field__label",
        for: "jwa-field-pageRules",
        text: t("field.pageRules.label"),
      }),
      textarea,
      fieldError("pageRules", "field.pageRules.invalid"),
      h("div", { class: "jwa-rule-test" }, [
        h("span", { class: "jwa-field__label", text: t("field.pageRules.testLabel") }),
        testInput,
        testButton,
      ]),
      result,
      h("p", { class: "jwa-field__hint", text: t("field.pageRules.hint") }),
    ]);
  }

  function tileOption(groupKey, value, labelKey, buildPreview) {
    var tile = h("label", { class: "jwa-tile" }, []);
    var input = h("input", {
      type: "radio",
      name: "jwa-" + groupKey,
      value: value,
      checked: state.form[groupKey] === value,
      onchange: function (event) {
        if (event.target.checked) setFormValue(groupKey, value);
      },
    });
    tile.appendChild(input);
    if (buildPreview) tile.appendChild(buildPreview());
    tile.appendChild(h("span", { class: "jwa-tile__label", text: t(labelKey) }));
    return tile;
  }

  function renderTabAppearance() {
    var color = String(state.form.buttonColor || "#25d366");
    var isPreset = PRESET_COLORS.some(function (entry) {
      return entry.value === color.toLowerCase();
    });

    var swatches = h(
      "div",
      { class: "jwa-tiles", role: "radiogroup", "aria-label": t("field.buttonColor.label") },
      [],
    );
    PRESET_COLORS.forEach(function (entry) {
      var tile = h("label", { class: "jwa-swatch" }, [
        h("input", {
          type: "radio",
          name: "jwa-buttonColor",
          value: entry.value,
          checked: isPreset && color.toLowerCase() === entry.value,
          onchange: function (event) {
            if (event.target.checked) setFormValue("buttonColor", entry.value);
          },
        }),
        h("span", { class: "jwa-swatch__dot" }),
        h("span", { class: "jwa-swatch__name", text: t(entry.key) }),
      ]);
      tile.firstChild.nextSibling.style.background = entry.value;
      swatches.appendChild(tile);
    });

    var customTile = h("label", { class: "jwa-swatch" }, [
      h("input", {
        type: "radio",
        name: "jwa-buttonColor",
        value: "custom",
        checked: !isPreset,
        onchange: function (event) {
          if (event.target.checked) {
            var input = document.getElementById("jwa-field-buttonColor");
            if (input) {
              setFormValue("buttonColor", input.value.trim() || "#25d366");
            }
          }
        },
      }),
      h("span", { class: "jwa-swatch__dot" }),
      h("span", { class: "jwa-swatch__name", text: t("color.custom") }),
    ]);
    customTile.firstChild.nextSibling.style.background = "transparent";
    customTile.firstChild.nextSibling.style.borderColor = "var(--jwa-border-strong)";
    swatches.appendChild(customTile);

    return h("div", {}, [
      h("section", { class: "jwa-card" }, [
        h("div", { class: "jwa-card__head" }, [
          h("h2", { class: "jwa-card__title", text: t("tab.appearance") }),
        ]),
        h("div", { class: "jwa-card__body" }, [
          h("div", { class: "jwa-field" }, [
            h("span", { class: "jwa-field__label", text: t("field.buttonPosition.label") }),
            h(
              "div",
              {
                class: "jwa-tiles",
                role: "radiogroup",
                "aria-label": t("field.buttonPosition.label"),
              },
              [
                tileOption(
                  "buttonPosition",
                  "bottom-right",
                  "option.position.bottom-right",
                  function () {
                    return h("span", { class: "jwa-tile__box" }, [
                      fabNode("small", "bottom-right", state.form.buttonColor || "#25d366"),
                    ]);
                  },
                ),
                tileOption(
                  "buttonPosition",
                  "bottom-left",
                  "option.position.bottom-left",
                  function () {
                    return h("span", { class: "jwa-tile__box" }, [
                      fabNode("small", "bottom-left", state.form.buttonColor || "#25d366"),
                    ]);
                  },
                ),
              ],
            ),
            h("p", { class: "jwa-field__hint", text: t("field.buttonPosition.hint") }),
          ]),
          h("div", { class: "jwa-field" }, [
            h("span", { class: "jwa-field__label", text: t("field.buttonSize.label") }),
            h(
              "div",
              { class: "jwa-tiles", role: "radiogroup", "aria-label": t("field.buttonSize.label") },
              [
                tileOption("buttonSize", "small", "option.size.small", function () {
                  return h("span", { class: "jwa-tile__box" }, [
                    fabNode("small", "bottom-right", "#25d366"),
                  ]);
                }),
                tileOption("buttonSize", "medium", "option.size.medium", function () {
                  return h("span", { class: "jwa-tile__box" }, [
                    fabNode("medium", "bottom-right", "#25d366"),
                  ]);
                }),
                tileOption("buttonSize", "large", "option.size.large", function () {
                  return h("span", { class: "jwa-tile__box" }, [
                    fabNode("large", "bottom-right", "#25d366"),
                  ]);
                }),
              ],
            ),
          ]),
          h("div", { class: "jwa-field" }, [
            h("span", { class: "jwa-field__label", text: t("field.buttonColor.label") }),
            swatches,
            labeledInput("buttonColor", "color.custom", "field.buttonColor.hint", {
              placeholder: "#25D366",
            }),
            fieldError("buttonColor", "field.buttonColor.invalid"),
          ]),
        ]),
      ]),
    ]);
  }

  function renderTabIdentity() {
    var photo = String(state.form.agentPhoto || "").trim();
    var name = String(state.form.agentName || "").trim();
    var role = String(state.form.agentRole || "").trim();

    var avatar = photo
      ? h("img", { class: "jwa-identity-preview__avatar", src: photo, alt: "" })
      : h("span", { class: "jwa-identity-preview__avatar", text: "💬" });

    var preview = h("div", { class: "jwa-identity-preview" }, [
      avatar,
      h("div", {}, [
        h("p", { class: "jwa-identity-preview__name", text: name || t("field.agentName.placeholder") }),
        role ? h("p", { class: "jwa-identity-preview__role", text: role }) : null,
      ]),
    ]);

    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.identity") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        labeledInput("agentName", "field.agentName.label", "field.agentName.hint", {
          placeholder: "Ama Mensah",
        }),
        labeledInput("agentRole", "field.agentRole.label", "field.agentRole.hint", {
          placeholder: "Sales at Brayne",
        }),
        h("div", { class: "jwa-field" }, [
          h("span", { class: "jwa-field__label", text: t("field.agentPhoto.label") }),
          h("div", { class: "jwa-rule-test" }, [
            h(
              "button",
              { class: "jwa-btn jwa-btn--ghost", type: "button", onclick: openMediaGallery },
              [t("identity.mediaPick")],
            ),
            h("span", { class: "jwa-field__hint", text: t("identity.mediaHint") }),
          ]),
        ]),
        labeledInput("agentPhoto", "", "field.agentPhoto.hint", {
          placeholder: "/media/team/ama.png",
        }),
        fieldError("agentPhoto", "field.agentPhoto.invalid"),
        h("div", { class: "jwa-field" }, [
          h("span", { class: "jwa-field__label", text: t("identity.preview") }),
          preview,
        ]),
      ]),
      state.mediaOpen ? mediaGalleryNode() : null,
    ]);
  }

  /** Load the site's image library through the core media API (same-origin, same session). */
  function openMediaGallery() {
    state.mediaOpen = true;
    state.mediaError = "";
    state.mediaItems = [];
    render();
    fetchJson("/api/media?limit=80&kind=image")
      .then(function (result) {
        if (!result.ok) {
          state.mediaError = t("identity.mediaError");
          render();
          return;
        }
        var items = (result.body && Array.isArray(result.body.items) ? result.body.items : [])
          .map(function (item) {
            return {
              url: String(item.url || ""),
              filename: String(item.filename || item.url || ""),
            };
          })
          .filter(function (item) {
            return item.url.length > 0;
          });
        state.mediaItems = items;
        render();
      })
      .catch(function () {
        state.mediaError = t("identity.mediaError");
        render();
      });
  }

  function closeMediaGallery() {
    state.mediaOpen = false;
    state.mediaItems = [];
    state.mediaError = "";
    render();
  }

  function mediaGalleryNode() {
    var grid = h(
      "div",
      { class: "jwa-media-grid", role: "listbox", "aria-label": t("identity.mediaPick") },
      [],
    );
    if (state.mediaError) {
      grid.appendChild(h("p", { class: "jwa-rule-result", text: state.mediaError }));
    } else if (state.mediaItems.length === 0) {
      grid.appendChild(h("p", { class: "jwa-rule-result", text: t("identity.mediaEmpty") }));
    }
    state.mediaItems.forEach(function (item) {
      var thumb = h(
        "button",
        {
          class: "jwa-media-thumb",
          type: "button",
          role: "option",
          title: item.filename,
          onclick: function () {
            setFormValue("agentPhoto", item.url);
            closeMediaGallery();
          },
        },
        [],
      );
      thumb.appendChild(h("img", { class: "jwa-media-thumb__img", src: item.url, alt: item.filename, loading: "lazy" }));
      thumb.appendChild(h("span", { class: "jwa-media-thumb__name", text: item.filename }));
      grid.appendChild(thumb);
    });

    var dialog = h(
      "div",
      {
        class: "jwa-media-gallery",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": t("identity.mediaPick"),
      },
      [
        h("div", { class: "jwa-media-gallery__head" }, [
          h("p", { class: "jwa-card__title", text: t("identity.mediaPick") }),
          h(
            "button",
            { class: "jwa-btn jwa-btn--ghost", type: "button", onclick: closeMediaGallery },
            [t("identity.mediaClose")],
          ),
        ]),
        grid,
      ],
    );
    var backdrop = h("div", { class: "jwa-media-backdrop", onclick: closeMediaGallery }, []);
    return h("div", { class: "jwa-media-modal" }, [backdrop, dialog]);
  }

  var DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

  function syncEditorState() {
    var windows = [];
    try {
      var parsed = JSON.parse(String(state.form.schedule || "[]"));
      if (Array.isArray(parsed)) {
        windows = parsed.map(function (entry) {
          return {
            days: Array.isArray(entry.days) ? entry.days.slice() : [],
            open: typeof entry.open === "string" ? entry.open : "09:00",
            close: typeof entry.close === "string" ? entry.close : "17:00",
          };
        });
      }
    } catch (err) {
      windows = [];
    }
    state.scheduleWindows = windows;

    var holidays = [];
    try {
      var parsedHolidays = JSON.parse(String(state.form.holidays || "[]"));
      if (Array.isArray(parsedHolidays)) {
        holidays = parsedHolidays.map(function (entry) {
          var from =
            typeof entry.from === "string" ? entry.from : typeof entry.date === "string" ? entry.date : "";
          var to = typeof entry.to === "string" ? entry.to : from;
          return { from: from, to: to, label: typeof entry.label === "string" ? entry.label : "" };
        });
      }
    } catch (err) {
      holidays = [];
    }
    state.holidayEntries = holidays;
  }

  function parseDepartmentEntries() {
    var departments = [];
    try {
      var parsed = JSON.parse(String(state.form.departments || "[]"));
      if (Array.isArray(parsed)) {
        departments = parsed.map(function (entry) {
          return {
            name: typeof entry.name === "string" ? entry.name : "",
            number: typeof entry.number === "string" ? entry.number : "",
            icon: typeof entry.icon === "string" ? entry.icon : "",
          };
        });
      }
    } catch (err) {
      departments = [];
    }
    state.departmentEntries = departments;
  }

  function serializeSchedule() {
    return JSON.stringify(
      state.scheduleWindows.map(function (window) {
        return { days: window.days, open: window.open, close: window.close };
      }),
    );
  }

  function serializeHolidays() {
    return JSON.stringify(
      state.holidayEntries.map(function (holiday) {
        return { from: holiday.from, to: holiday.to, label: holiday.label };
      }),
    );
  }

  function scheduleEditorNode() {
    var list = h("div", { class: "jwa-schedule" }, []);
    state.scheduleWindows.forEach(function (window, index) {
      var dayChips = h(
        "div",
        { class: "jwa-day-chips", role: "group", "aria-label": t("hours.schedule.days") },
        [],
      );
      DAY_LETTERS.forEach(function (letter, day) {
        var active = window.days.indexOf(day) !== -1;
        dayChips.appendChild(
          h(
            "button",
            {
              class: "jwa-day-chip" + (active ? " jwa-day-chip--on" : ""),
              type: "button",
              "aria-pressed": String(active),
              title: letter,
              onclick: function () {
                var days = window.days.slice();
                var at = days.indexOf(day);
                if (at === -1) days.push(day);
                else days.splice(at, 1);
                window.days = days.sort(function (a, b) {
                  return a - b;
                });
                setFormValue("schedule", serializeSchedule());
                render();
              },
            },
            [letter],
          ),
        );
      });

      var openInput = h("input", {
        class: "jwa-input jwa-input--time",
        value: window.open,
        "aria-label": t("hours.schedule.open"),
        oninput: function (event) {
          window.open = event.target.value;
          setFormValue("schedule", serializeSchedule());
        },
      });
      var closeInput = h("input", {
        class: "jwa-input jwa-input--time",
        value: window.close,
        "aria-label": t("hours.schedule.close"),
        oninput: function (event) {
          window.close = event.target.value;
          setFormValue("schedule", serializeSchedule());
        },
      });
      var removeButton = h(
        "button",
        {
          class: "jwa-btn jwa-btn--ghost",
          type: "button",
          "aria-label": t("hours.schedule.remove"),
          onclick: function () {
            state.scheduleWindows.splice(index, 1);
            setFormValue("schedule", serializeSchedule());
            render();
          },
        },
        [t("hours.schedule.remove")],
      );

      list.appendChild(h("div", { class: "jwa-schedule__row" }, [dayChips, openInput, closeInput, removeButton]));
    });

    var addButton = h(
      "button",
      {
        class: "jwa-btn jwa-btn--ghost",
        type: "button",
        onclick: function () {
          state.scheduleWindows.push({ days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00" });
          setFormValue("schedule", serializeSchedule());
          render();
        },
      },
      [t("hours.schedule.add")],
    );

    return h("div", { class: "jwa-field" }, [
      h("span", { class: "jwa-field__label", text: t("hours.schedule.title") }),
      list,
      addButton,
      fieldError("schedule", "hours.schedule.invalid"),
      h("p", { class: "jwa-field__hint", text: t("hours.schedule.hint") }),
    ]);
  }

  function holidayEditorNode() {
    var list = h("div", { class: "jwa-holidays" }, []);
    state.holidayEntries.forEach(function (holiday, index) {
      var fromInput = h("input", {
        class: "jwa-input",
        value: holiday.from,
        placeholder: "2026-12-25",
        "aria-label": t("hours.holidays.from"),
        oninput: function (event) {
          holiday.from = event.target.value;
          if (!holiday.to) holiday.to = holiday.from;
          setFormValue("holidays", serializeHolidays());
        },
      });
      var toInput = h("input", {
        class: "jwa-input",
        value: holiday.to,
        placeholder: "2026-12-25",
        "aria-label": t("hours.holidays.to"),
        oninput: function (event) {
          holiday.to = event.target.value;
          setFormValue("holidays", serializeHolidays());
        },
      });
      var labelInput = h("input", {
        class: "jwa-input jwa-input--label",
        value: holiday.label,
        placeholder: t("hours.holidays.labelPlaceholder"),
        "aria-label": t("hours.holidays.label"),
        oninput: function (event) {
          holiday.label = event.target.value;
          setFormValue("holidays", serializeHolidays());
        },
      });
      var removeButton = h(
        "button",
        {
          class: "jwa-btn jwa-btn--ghost",
          type: "button",
          "aria-label": t("hours.holidays.remove"),
          onclick: function () {
            state.holidayEntries.splice(index, 1);
            setFormValue("holidays", serializeHolidays());
            render();
          },
        },
        [t("hours.holidays.remove")],
      );
      list.appendChild(
        h("div", { class: "jwa-holiday__row" }, [fromInput, toInput, labelInput, removeButton]),
      );
    });

    var addButton = h(
      "button",
      {
        class: "jwa-btn jwa-btn--ghost",
        type: "button",
        onclick: function () {
          state.holidayEntries.push({ from: "", to: "", label: "" });
          setFormValue("holidays", serializeHolidays());
          render();
        },
      },
      [t("hours.holidays.add")],
    );

    return h("div", { class: "jwa-field" }, [
      h("span", { class: "jwa-field__label", text: t("hours.holidays.title") }),
      list,
      addButton,
      fieldError("holidays", "hours.holidays.invalid"),
      h("p", { class: "jwa-field__hint", text: t("hours.holidays.hint") }),
    ]);
  }

  function renderTabHours() {
    var zones = h("select", {
      id: "jwa-field-businessTimezone",
      class: "jwa-input",
      onchange: function (event) {
        setFormValue("businessTimezone", event.target.value);
      },
    });
    zones.appendChild(
      h(
        "option",
        {
          value: "",
          selected: !state.form.businessTimezone ? true : null,
        },
        [t("field.businessTimezone.siteDefault") + " (" + (state.data.siteTimeZone || "UTC") + ")"],
      ),
    );
    var zoneList = [];
    try {
      if (typeof Intl !== "undefined" && Intl.supportedValuesOf) {
        zoneList = Intl.supportedValuesOf("timeZone") || [];
      }
    } catch (err) {
      zoneList = [];
    }
    if (state.form.businessTimezone && zoneList.indexOf(state.form.businessTimezone) === -1) {
      zoneList = [state.form.businessTimezone].concat(zoneList);
    }
    zoneList.slice(0, 420).forEach(function (zone) {
      zones.appendChild(
        h("option", { value: zone, selected: state.form.businessTimezone === zone ? true : null }, [
          zone,
        ]),
      );
    });

    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.hours") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        checkrowNode(
          "businessHoursEnabled",
          "field.businessHoursEnabled.label",
          "field.businessHoursEnabled.hint",
        ),
        scheduleEditorNode(),
        holidayEditorNode(),
        h("div", { class: "jwa-field" }, [
          h("label", {
            class: "jwa-field__label",
            for: "jwa-field-businessTimezone",
            text: t("field.businessTimezone.label"),
          }),
          zones,
          h("p", { class: "jwa-field__hint", text: t("field.businessTimezone.hint") }),
        ]),
        labeledInput("openLabel", "field.openLabel.label", "field.openLabel.hint"),
        labeledInput("closedLabel", "field.closedLabel.label", "field.closedLabel.hint"),
        labeledInput("closedExtra", "field.closedExtra.label", "field.closedExtra.hint"),
        h("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px" }, [
          labeledInput("openColor", "field.openColor.label", "field.badgeColor.hint", {
            placeholder: "#12A150",
          }),
          labeledInput("closedColor", "field.closedColor.label", "field.badgeColor.hint", {
            placeholder: "#B45309",
          }),
        ]),
        fieldError("openColor", "field.badgeColor.invalid"),
        fieldError("closedColor", "field.badgeColor.invalid"),
      ]),
    ]);
  }

  function serializeDepartments() {
    return JSON.stringify(
      state.departmentEntries.map(function (department) {
        return { name: department.name, number: department.number, icon: department.icon };
      }),
    );
  }

  function departmentsEditorNode() {
    var list = h("div", { class: "jwa-schedule" }, []);
    state.departmentEntries.forEach(function (department, index) {
      var nameInput = h("input", {
        class: "jwa-input",
        value: department.name,
        placeholder: t("routing.namePlaceholder"),
        "aria-label": t("routing.name"),
        oninput: function (event) {
          department.name = event.target.value;
          setFormValue("departments", serializeDepartments());
        },
      });
      var iconInput = h("input", {
        class: "jwa-input jwa-input--icon",
        value: department.icon,
        placeholder: "💼",
        "aria-label": t("routing.icon"),
        oninput: function (event) {
          department.icon = event.target.value;
          setFormValue("departments", serializeDepartments());
        },
      });
      var numberInput = h("input", {
        class: "jwa-input jwa-input--number",
        value: department.number,
        placeholder: "+233201234567",
        "aria-label": t("routing.number"),
        oninput: function (event) {
          department.number = event.target.value;
          setFormValue("departments", serializeDepartments());
        },
      });
      var removeButton = h(
        "button",
        {
          class: "jwa-btn jwa-btn--ghost",
          type: "button",
          "aria-label": t("routing.remove"),
          onclick: function () {
            state.departmentEntries.splice(index, 1);
            setFormValue("departments", serializeDepartments());
            render();
          },
        },
        [t("routing.remove")],
      );
      list.appendChild(
        h("div", { class: "jwa-schedule__row" }, [iconInput, nameInput, numberInput, removeButton]),
      );
    });

    var addButton = h(
      "button",
      {
        class: "jwa-btn jwa-btn--ghost",
        type: "button",
        onclick: function () {
          state.departmentEntries.push({ name: "", number: "", icon: "" });
          setFormValue("departments", serializeDepartments());
          render();
        },
      },
      [t("routing.add")],
    );

    return h("div", { class: "jwa-field" }, [
      h("span", { class: "jwa-field__label", text: t("routing.departments") }),
      list,
      addButton,
      fieldError("departments", "routing.invalid"),
      h("p", { class: "jwa-field__hint", text: t("routing.hint") }),
    ]);
  }

  function renderTabRouting() {
    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.routing") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        departmentsEditorNode(),
        labeledInput("catalogUrl", "routing.catalog.label", "routing.catalog.hint", {
          placeholder: "https://wa.me/c/15551234567",
        }),
        fieldError("catalogUrl", "routing.catalog.invalid"),
      ]),
    ]);
  }

  function renderTabLeads() {
    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.leads") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        checkrowNode(
          "leadFormEnabled",
          "field.leadFormEnabled.label",
          "field.leadFormEnabled.hint",
        ),
        labeledInput("leadInterests", "field.leadInterests.label", "field.leadInterests.hint", {
          multiline: true,
          rows: 4,
          placeholder: "A quote\nSupport\nBookings",
        }),
        labeledInput(
          "leadConsentText",
          "field.leadConsentText.label",
          "field.leadConsentText.hint",
          { multiline: true, rows: 2 },
        ),
        fieldError("leadConsentText", "field.leadConsentText.invalid"),
        h("p", { class: "jwa-field__hint", text: t("leads.privacy") }),
      ]),
    ]);
  }

  /** The last N days ending at the server's local date, newest first. */
  function analyticsDays() {
    var today = String(state.data && state.data.today ? state.data.today : "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
    var days = [];
    for (var offset = state.analyticsRange - 1; offset >= 0; offset -= 1) {
      days.push(dayOffset(today, -offset));
    }
    return days;
  }

  /** Shift a `YYYY-MM-DD` date by whole days (UTC math, so DST cannot bite). */
  function dayOffset(date, offset) {
    var parts = date.split("-").map(Number);
    var time = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    return new Date(time + offset * 86400000).toISOString().slice(0, 10);
  }

  function trendChartNode() {
    var days = analyticsDays();
    var events = ["open", "preset", "send"];
    var max = 1;
    var series = days.map(function (day) {
      var row = {};
      events.forEach(function (event) {
        row[event] = Number(state.data.counters[event + ":" + day] || 0);
        if (row[event] > max) max = row[event];
      });
      return { day: day, row: row };
    });

    var chart = h(
      "div",
      { class: "jwa-chart", role: "img", "aria-label": t("analytics.trend") },
      [],
    );
    series.forEach(function (entry) {
      var column = h("div", { class: "jwa-chart__col" }, []);
      events.forEach(function (event) {
        var count = entry.row[event];
        var bar = h("span", {
          class: "jwa-chart__bar jwa-chart__bar--" + event,
          title: entry.day + " · " + t("analytics.event." + event) + ": " + count,
        });
        bar.style.height = count > 0 ? Math.max(2, Math.round((count / max) * 64)) + "px" : "2px";
        column.appendChild(bar);
      });
      column.appendChild(h("span", { class: "jwa-chart__day", text: entry.day.slice(5) }));
      chart.appendChild(column);
    });
    return chart;
  }

  function heatMapNode() {
    var totals = [];
    var max = 1;
    for (var hour = 0; hour < 24; hour += 1) {
      var opens = Number(state.data.counters["openhour:" + hour] || 0);
      var sends = Number(state.data.counters["sendhour:" + hour] || 0);
      totals.push({ hour: hour, opens: opens, sends: sends });
      if (opens + sends > max) max = opens + sends;
    }
    var map = h(
      "div",
      { class: "jwa-heat", role: "img", "aria-label": t("analytics.hours") },
      [],
    );
    totals.forEach(function (cell) {
      var total = cell.opens + cell.sends;
      var cellNode = h("span", {
        class: "jwa-heat__cell",
        title:
          String(cell.hour).padStart(2, "0") +
          ":00 — " +
          cell.opens +
          " " +
          t("analytics.event.open").toLowerCase() +
          ", " +
          cell.sends +
          " " +
          t("analytics.event.send").toLowerCase(),
        text: String(cell.hour),
      });
      cellNode.style.opacity = total > 0 ? String(0.25 + 0.75 * (total / max)) : "0.15";
      map.appendChild(cellNode);
    });
    return map;
  }

  function topPagesNode() {
    if (state.form.analyticsPages !== true) {
      return h("p", { class: "jwa-field__hint", text: t("analytics.pagesOff") });
    }
    var days = analyticsDays();
    var pages = {};
    Object.keys(state.data.counters).forEach(function (key) {
      var match = /^openpage:(.*):\d{4}-\d{2}-\d{2}$/.exec(key);
      if (!match) return;
      var date = key.slice(-10);
      if (days.indexOf(date) === -1) return;
      pages[match[1]] = (pages[match[1]] || 0) + Number(state.data.counters[key] || 0);
    });
    var entries = Object.keys(pages)
      .map(function (path) {
        return { path: path, count: pages[path] };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      })
      .slice(0, 20);
    if (entries.length === 0) {
      return h("p", { class: "jwa-field__hint", text: t("analytics.pagesEmpty") });
    }
    var list = h("ul", { class: "jwa-pages" }, []);
    entries.forEach(function (entry) {
      list.appendChild(
        h("li", { class: "jwa-pages__row" }, [
          h("span", { class: "jwa-pages__path", text: entry.path }),
          h("span", { class: "jwa-pages__count", text: String(entry.count) }),
        ]),
      );
    });
    return list;
  }

  function exportCsv() {
    fetch(API_BASE + "/csv", { credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        return response.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "whatsapp-connect-counters.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
      })
      .catch(function () {
        /** Export is a convenience; a failure changes nothing. */
      });
  }

  function renderTabAnalytics() {
    var rangeButtons = [14, 30].map(function (range) {
      return h(
        "button",
        {
          class:
            "jwa-tab jwa-tab--range" +
            (state.analyticsRange === range ? " jwa-tab--range-on" : ""),
          type: "button",
          "aria-pressed": String(state.analyticsRange === range),
          onclick: function () {
            state.analyticsRange = range;
            render();
          },
        },
        [t("analytics.range" + range)],
      );
    });

    return h("div", {}, [
      h("section", { class: "jwa-card" }, [
        h("div", { class: "jwa-card__head" }, [
          h("h2", { class: "jwa-card__title", text: t("analytics.trend") }),
          h("div", { class: "jwa-head-actions" }, [
            h(
              "button",
              { class: "jwa-btn jwa-btn--ghost", type: "button", onclick: exportCsv },
              [t("analytics.export")],
            ),
            rangeButtons[0],
            rangeButtons[1],
          ]),
        ]),
        h("div", { class: "jwa-card__body" }, [trendChartNode()]),
      ]),
      h("section", { class: "jwa-card" }, [
        h("div", { class: "jwa-card__head" }, [
          h("h2", { class: "jwa-card__title", text: t("analytics.hours") }),
        ]),
        h("div", { class: "jwa-card__body" }, [
          heatMapNode(),
          h("p", { class: "jwa-field__hint", text: t("analytics.hoursHint") }),
        ]),
      ]),
      h("section", { class: "jwa-card" }, [
        h("div", { class: "jwa-card__head" }, [
          h("h2", { class: "jwa-card__title", text: t("analytics.pages") }),
        ]),
        h("div", { class: "jwa-card__body" }, [topPagesNode()]),
      ]),
    ]);
  }

  function renderTabPrivacy() {
    return h("div", {}, [
      h("section", { class: "jwa-card" }, [
        h("div", { class: "jwa-card__head" }, [
          h("h2", { class: "jwa-card__title", text: t("tab.privacy") }),
        ]),
        h("div", { class: "jwa-card__body" }, [
          checkrowNode(
            "analyticsEnabled",
            "field.analyticsEnabled.label",
            "field.analyticsEnabled.hint",
          ),
          checkrowNode(
            "analyticsPages",
            "field.analyticsPages.label",
            "field.analyticsPages.hint",
          ),
          checkrowNode(
            "utmPropagation",
            "field.utmPropagation.label",
            "field.utmPropagation.hint",
          ),
          h("div", { class: "jwa-field" }, [
            h("span", { class: "jwa-field__label", text: t("privacy.store.title") }),
            h(
              "ul",
              { class: "jwa-privacy-list" },
              [
                "privacy.store.counters",
                "privacy.store.noPersonal",
                "privacy.store.chats",
                "privacy.store.delete",
              ].map(function (key) {
                return h("li", { text: t(key) });
              }),
            ),
          ]),
        ]),
      ]),
    ]);
  }

  /* ------------------------------------------------------------------ save */

  /** The same rules the server applies, so bad values never leave the frame. */
  function collectClientErrors() {
    var errors = {};
    if (!numberLooksValid(state.form.whatsappNumber)) {
      errors.whatsappNumber = t("field.whatsappNumber.invalid");
    }
    if (!hexLooksValid(state.form.buttonColor)) {
      errors.buttonColor = t("field.buttonColor.invalid");
    }
    if (!presetsLookValid(state.form.presetMessages || "")) {
      errors.presetMessages = t("field.presetMessages.invalid");
    }
    if (!pageRulesLookValid(state.form.pageRules)) {
      errors.pageRules = t("field.pageRules.invalid");
    }
    if (!agentPhotoLooksValid(state.form.agentPhoto)) {
      errors.agentPhoto = t("field.agentPhoto.invalid");
    }
    if (String(state.form.agentName || "").length > 60) {
      errors.agentName = t("field.agentName.invalid");
    }
    if (String(state.form.agentRole || "").length > 60) {
      errors.agentRole = t("field.agentRole.invalid");
    }
    if (!scheduleLooksValid(state.scheduleWindows)) {
      errors.schedule = t("hours.schedule.invalid");
    }
    if (!holidaysLookValid(state.holidayEntries)) {
      errors.holidays = t("hours.holidays.invalid");
    }
    if (String(state.form.openLabel || "").length > 60) {
      errors.openLabel = t("hours.label.tooLong");
    }
    if (String(state.form.closedLabel || "").length > 60) {
      errors.closedLabel = t("hours.label.tooLong");
    }
    if (String(state.form.closedExtra || "").length > 120) {
      errors.closedExtra = t("hours.extra.tooLong");
    }
    if (!hexLooksValid(state.form.openColor)) {
      errors.openColor = t("field.badgeColor.invalid");
    }
    if (!hexLooksValid(state.form.closedColor)) {
      errors.closedColor = t("field.badgeColor.invalid");
    }
    if (!departmentsLookValid(state.departmentEntries)) {
      errors.departments = t("routing.invalid");
    }
    var catalogUrl = String(state.form.catalogUrl || "").trim();
    if (
      catalogUrl.length > 0 &&
      (!/^https:\/\/wa\.me\/c\//.test(catalogUrl) ||
        /[\s"'<>]/.test(catalogUrl) ||
        catalogUrl.length > 300)
    ) {
      errors.catalogUrl = t("routing.catalog.invalid");
    }
    var interests = String(state.form.leadInterests || "")
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    if (interests.length > 8 || interests.some(function (line) {
      return line.length > 60;
    })) {
      errors.leadInterests = t("field.leadInterests.invalid");
    }
    var consent = String(state.form.leadConsentText || "").trim();
    if (state.form.leadFormEnabled === true && (consent.length === 0 || consent.length > 300)) {
      errors.leadConsentText = t("field.leadConsentText.invalid");
    }
    var delayRaw = String(state.form.nudgeDelaySeconds || "").trim();
    if (delayRaw.length > 0) {
      var delay = Number(delayRaw);
      if (!/^\d{1,3}$/.test(delayRaw) || delay < 5 || delay > 300) {
        errors.nudgeDelaySeconds = t("field.nudgeDelaySeconds.invalid");
      }
    }
    if (String(state.form.nudgeText || "").length > 120) {
      errors.nudgeText = t("field.nudgeText.invalid");
    }
    return errors;
  }

  function departmentsLookValid(entries) {
    if (!Array.isArray(entries) || entries.length > 5) return false;
    return entries.every(function (department) {
      if (!department || typeof department !== "object") return false;
      var name = String(department.name || "").trim();
      var icon = String(department.icon || "").trim();
      var number = String(department.number || "").trim();
      if (name.length === 0 || name.length > 40) return false;
      if (icon.length > 8) return false;
      if (number.length === 0 || !numberLooksValid(number)) return false;
      return true;
    });
  }

  function scheduleLooksValid(windows) {
    if (!Array.isArray(windows) || windows.length > 14) return false;
    return windows.every(function (window) {
      if (!Array.isArray(window.days) || window.days.length === 0) return false;
      if (
        window.days.some(function (day) {
          return typeof day !== "number" || day < 0 || day > 6;
        })
      ) {
        return false;
      }
      return clockLooksValid(window.open) && clockLooksValid(window.close);
    });
  }

  function holidayDateLooksValid(value) {
    var text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    var time = Date.parse(text + "T00:00:00Z");
    if (!Number.isFinite(time)) return false;
    var parsed = new Date(time);
    var parts = text.split("-").map(Number);
    return (
      parsed.getUTCFullYear() === parts[0] &&
      parsed.getUTCMonth() + 1 === parts[1] &&
      parsed.getUTCDate() === parts[2]
    );
  }

  function holidaysLookValid(entries) {
    if (!Array.isArray(entries) || entries.length > 20) return false;
    return entries.every(function (holiday) {
      if (!holidayDateLooksValid(holiday.from)) return false;
      if (holiday.to && (!holidayDateLooksValid(holiday.to) || holiday.to < holiday.from)) {
        return false;
      }
      return String(holiday.label || "").length <= 60;
    });
  }

  function save() {
    if (state.saving) return;
    var clientErrors = collectClientErrors();
    if (Object.keys(clientErrors).length > 0) {
      state.fieldErrors = clientErrors;
      state.saveError = t("settings.saveFailed");
      render();
      var first = document.querySelector('.jwa-input[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }

    state.saving = true;
    state.saveError = "";
    render();

    var token = readCsrfCookie();
    var send = function (csrf) {
      return fetchJson(API_BASE + "/admin-settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf || "",
        },
        body: JSON.stringify(state.form),
      });
    };

    var attempt = token
      ? Promise.resolve(token)
      : fetch("/api/auth/csrf", { credentials: "same-origin" })
          .catch(function () {
            return null;
          })
          .then(function () {
            return readCsrfCookie();
          });

    attempt
      .then(function (csrf) {
        return send(csrf);
      })
      .then(function (result) {
        state.saving = false;
        if (result.ok) {
          state.data = result.body;
          state.form = Object.assign({}, result.body.settings);
          syncEditorState();
          parseDepartmentEntries();
          state.dirty = false;
          state.saved = true;
          state.fieldErrors = {};
          bridge.reportDirty(false);
          render();
          return;
        }
        if (result.status === 403) {
          state.saveError = t("error.forbidden");
        } else {
          state.saveError =
            result.body && result.body.error ? result.body.error : t("settings.saveFailed");
          if (result.body && result.body.field) {
            state.fieldErrors[result.body.field] = result.body.error || "";
          }
        }
        render();
      })
      .catch(function () {
        state.saving = false;
        state.saveError = t("settings.saveFailed");
        render();
      });
  }

  /* ------------------------------------------------------------- catalog */

  function loadCatalog(context) {
    var catalogs = context && context.catalogs ? context.catalogs : null;
    var wanted = null;
    if (catalogs) {
      if (context.locale && catalogs[context.locale]) wanted = catalogs[context.locale];
      if (!wanted) {
        var base = String(context.locale || "en").split("-")[0];
        if (catalogs[base]) wanted = catalogs[base];
      }
      if (!wanted && catalogs.en) wanted = catalogs.en;
    }
    if (!wanted) return Promise.resolve();
    return fetch(wanted, { credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (body) {
        if (body && typeof body === "object") {
          state.catalog = Object.assign({}, FALLBACK, body);
          render();
        }
      })
      .catch(function () {
        /** A catalog that fails to load is a cosmetic loss, not an error. */
      });
  }

  /* ------------------------------------------------------------- theming */

  function applyTheme(theme) {
    var resolved = theme === "dark" || theme === "light" ? theme : "";
    state.theme = resolved;
    if (resolved) {
      document.documentElement.setAttribute("data-jwa-theme", resolved);
      return;
    }
    document.documentElement.removeAttribute("data-jwa-theme");
    if (window.matchMedia) {
      var media = window.matchMedia("(prefers-color-scheme: dark)");
      var sync = function () {
        if (state.theme) return;
        if (media.matches) document.documentElement.setAttribute("data-jwa-theme", "dark");
        else document.documentElement.removeAttribute("data-jwa-theme");
        render();
      };
      if (media.addEventListener) media.addEventListener("change", sync);
      sync();
    }
  }

  /* ------------------------------------------------------------------ boot */

  bridge.onContext(function (context) {
    state.locale = context.locale || "en";
    applyTheme(context.theme || "");
    loadCatalog(context)
      .then(function () {
        return loadData();
      })
      .then(render);
  });

  bridge.autoResize();
  render();
  bridge.ready();
})();
