// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Brayne WhatsApp Connect — front-end widget.
 *
 * The host injects this file on every public page from the manifest's
 * `assets.scripts` entry: a `<script defer>` tag, or concatenated into the
 * shared `/jf-plugins.<hash>.js` bundle which already wraps each plugin in an
 * IIFE. Both paths are handled by the load guard below, so the widget renders
 * exactly once no matter how many times the code runs.
 *
 * Settings are never inlined into the page. `html.head` is a synchronous
 * filter and cannot await `ctx.settings`, so the widget asks
 * `GET /api/brayne-whatsapp-connect/config` instead and renders nothing if
 * that request fails — a missing widget is better than a wrong one.
 *
 * Interactions are counted with `POST .../analytics?event=<name>` carrying no
 * request body. Without a body the browser sends no `Content-Type`, which
 * keeps the call a CORS "simple request": no preflight, so it also works from
 * a statically exported page served on another origin.
 *
 * Privacy: this file reads and writes no cookie, no storage and no
 * identifier. Every string that arrives from the config is written with
 * `textContent`, never `innerHTML`.
 */
(function () {
  "use strict";

  var LOAD_GUARD = "__brayneWhatsAppConnectLoaded";
  if (window[LOAD_GUARD]) return;
  window[LOAD_GUARD] = true;

  var CONFIG_URL = "/api/brayne-whatsapp-connect/config";
  var ANALYTICS_URL = "/api/brayne-whatsapp-connect/analytics";

  var PANEL_ID = "jwa-panel";
  var MESSAGE_ID = "jwa-message";
  var NUDGE_KEY = "brayne-whatsapp-connect-nudge-dismissed";

  var DEFAULT_COLOR = "#25d366";
  var HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  var NUMBER_RE = /^\d{7,15}$/;

  var MAX_PRESETS = 6;
  var MAX_PRESET_LENGTH = 200;
  var MAX_WELCOME_LENGTH = 500;

  /** Re-read the config this often so the Open / Closed badge cannot go stale. */
  var RESYNC_MS = 5 * 60 * 1000;

  /**
   * The config URL for this page load: the widget sends its own path (page
   * rules) and the browser language (the "auto" language mode) as query
   * parameters. A query string keeps the call a CORS simple request, so a
   * statically exported page can still fetch it.
   */
  function configUrl() {
    var page = "";
    var lang = "";
    try {
      page = encodeURIComponent(
        window.location && window.location.pathname ? window.location.pathname : "/",
      );
    } catch (err) {
      page = "";
    }
    try {
      lang = encodeURIComponent(
        (typeof navigator !== "undefined" && navigator.language) || "",
      );
    } catch (err) {
      lang = "";
    }
    return CONFIG_URL + "?page=" + page + "&lang=" + lang;
  }

  /**
   * Built-in English copy. The config payload normally ships a `strings`
   * table resolved server-side; this table keeps the widget rendering correct
   * English if that field is missing or a value has the wrong type. It is the
   * same catalog as `src/strings.ts` (a test pins them together).
   */
  var STRING_FALLBACK = {
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

  /** Scalar string keys; `dayNames` is the one array value and is handled separately. */
  var STRING_KEYS = [
    "fabLabel",
    "panelTitle",
    "avatarGlyph",
    "closeLabel",
    "closeAriaLabel",
    "statusOpen",
    "statusClosed",
    "statusClosedNext",
    "statusIdle",
    "presetsAriaLabel",
    "messageLabel",
    "messagePlaceholder",
    "sendLabel",
    "daysMonFri",
    "daysMonSat",
    "daysEvery",
    "catalogLabel",
    "departmentsAriaLabel",
    "leadNameLabel",
    "leadInterestLabel",
    "leadContinueLabel",
    "leadNameInvalid",
    "leadConsentRequired",
    "nudgeDefault",
    "nudgeCloseLabel",
    "tooltipSeparator",
    "tooltipRange",
  ];

  var WHATSAPP_PATH =
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z";

  /** The last config accepted from the server; `null` until one arrives. */
  var currentConfig = null;
  /** UI copy in use right now: the config's table, or the built-in English one. */
  var STR = STRING_FALLBACK;
  var root = null;
  var panel = null;
  var fab = null;
  var statusEl = null;
  var statusExtraEl = null;
  var welcomeEl = null;
  var agentTitleEl = null;
  var agentRoleEl = null;
  var messageEl = null;
  var sendEl = null;
  var deptRowEl = null;
  var leadNameEl = null;
  var leadInterestEl = null;
  var leadConsentEl = null;
  var leadErrorEl = null;
  var nudgeEl = null;
  var nudgeTimer = 0;
  /** pending → shown | dismissed | skipped; the timer respects this state. */
  var nudgeState = "pending";
  /** True once the visitor opens the panel themselves; kills the nudge. */
  var panelOpened = false;
  var resyncTimer = 0;
  var didWarn = false;
  /** Which department chip is selected; 0 = the first. */
  var currentDept = 0;

  /**
   * Build an element. Text always goes through `textContent`, so a value that
   * somehow carried markup renders as literal characters instead of running.
   *
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function svgEl(name, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) node.setAttribute(key, attrs[key]);
    }
    return node;
  }

  /**
   * Bounded copy of the `strings` table from the config: every scalar key
   * must arrive as a string or the built-in English value stands in, and
   * `dayNames` must be a complete 7-item array. A hostile or half-shipped
   * config therefore cannot break the panel, it can only fall back.
   *
   * @param {unknown} raw
   * @returns {object}
   */
  function pickStrings(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var values = source.values && typeof source.values === "object" ? source.values : source;
    var out = {};
    STRING_KEYS.forEach(function (key) {
      out[key] = typeof values[key] === "string" ? values[key] : STRING_FALLBACK[key];
    });
    var days = Array.isArray(values.dayNames)
      ? values.dayNames.filter(function (name) {
          return typeof name === "string" && name.length > 0;
        })
      : [];
    out.dayNames = days.length === 7 ? days : STRING_FALLBACK.dayNames;
    return out;
  }

  /**
   * Coerce whatever the config endpoint returned into the exact shape the
   * renderer trusts. The server already normalises; this repeats the checks
   * because the value is about to become a `wa.me` link and an inline CSS
   * custom property, and a second opinion costs nothing.
   *
   * @param {unknown} raw
   * @returns {null | {
   *   version: number,
   *   number: string,
   *   welcome: string,
   *   presets: string[],
   *   position: "bottom-right" | "bottom-left",
   *   color: string,
   *   size: "small" | "medium" | "large",
   *   hours: { enabled: boolean, open: string, close: string, days: number[], openNow: boolean },
   *   strings: object,
   *   analytics: boolean
   * }}
   */
  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object") return null;

    // Version gate: anything ≥ 1 is fine; a missing field means a
    // pre-versioning server, read as 1. Unknown fields are ignored by
    // construction, so future additive payloads keep rendering.
    var version = raw.version === undefined ? 1 : raw.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;

    var number = typeof raw.number === "string" && NUMBER_RE.test(raw.number) ? raw.number : "";
    if (raw.enabled !== true || number === "") return null;

    var button = raw.button && typeof raw.button === "object" ? raw.button : {};
    var color =
      typeof button.color === "string" && HEX_COLOR_RE.test(button.color)
        ? button.color.toLowerCase()
        : DEFAULT_COLOR;
    var position = button.position === "bottom-left" ? "bottom-left" : "bottom-right";
    var size = button.size === "small" || button.size === "large" ? button.size : "medium";

    var hours = raw.hours && typeof raw.hours === "object" ? raw.hours : {};
    var bounded = function (value, max) {
      return typeof value === "string" ? value.slice(0, max) : "";
    };

    // Greeting: the split open/closed wording, with the legacy single
    // `welcomeMessage` as the fallback for a pre-Stage-1 server.
    var greeting = raw.greeting && typeof raw.greeting === "object" ? raw.greeting : {};
    var legacyWelcome =
      typeof raw.welcomeMessage === "string" ? raw.welcomeMessage.slice(0, MAX_WELCOME_LENGTH) : "";
    var greetingOpen =
      typeof greeting.open === "string" ? greeting.open.slice(0, MAX_WELCOME_LENGTH) : legacyWelcome;
    var greetingClosed =
      typeof greeting.closed === "string" ? greeting.closed.slice(0, MAX_WELCOME_LENGTH) : legacyWelcome;

    // Agent identity: the same allow-list the server applies (a same-site
    // media path or https URL, nothing that can break out of `img.src`).
    var agent = raw.agent && typeof raw.agent === "object" ? raw.agent : {};
    var agentName = typeof agent.name === "string" ? agent.name.slice(0, 60) : "";
    var agentRole = typeof agent.role === "string" ? agent.role.slice(0, 60) : "";
    var photoUrl =
      typeof agent.photoUrl === "string" &&
      /^(https:\/\/|\/)/.test(agent.photoUrl) &&
      !/[\s"'<>]/.test(agent.photoUrl) &&
      agent.photoUrl.length <= 300
        ? agent.photoUrl
        : "";

    // Departments: chips that swap the wa.me target. Every entry must carry a
    // usable number; names and icons are bounded and never touch markup.
    var departments = Array.isArray(raw.departments)
      ? raw.departments
          .slice(0, 5)
          .filter(function (entry) {
            return (
              entry &&
              typeof entry === "object" &&
              typeof entry.name === "string" &&
              entry.name.trim().length > 0 &&
              typeof entry.number === "string" &&
              NUMBER_RE.test(entry.number)
            );
          })
          .map(function (entry) {
            return {
              name: entry.name.trim().slice(0, 40),
              number: entry.number,
              icon: typeof entry.icon === "string" ? entry.icon.trim().slice(0, 8) : "",
            };
          })
      : [];

    // Catalog: the same allow-list the server applies.
    var catalogUrl =
      typeof raw.catalogUrl === "string" &&
      /^https:\/\/wa\.me\/c\//.test(raw.catalogUrl) &&
      !/[\s"'<>]/.test(raw.catalogUrl) &&
      raw.catalogUrl.length <= 300
        ? raw.catalogUrl
        : "";

    // Lead form: bounded copies of the operator's fields.
    var leadRaw = raw.lead && typeof raw.lead === "object" ? raw.lead : {};
    var lead = {
      enabled: leadRaw.enabled === true,
      interests: Array.isArray(leadRaw.interests)
        ? leadRaw.interests
            .filter(function (interest) {
              return typeof interest === "string";
            })
            .slice(0, 8)
            .map(function (interest) {
              return interest.trim().slice(0, 60);
            })
            .filter(function (interest) {
              return interest.length > 0;
            })
        : [],
      consentText:
        typeof leadRaw.consentText === "string" ? leadRaw.consentText.slice(0, 300) : "",
    };

    // Nudge: the teaser bubble, bounded and delayed on the client too.
    var nudgeRaw = raw.nudge && typeof raw.nudge === "object" ? raw.nudge : {};
    var nudge = {
      enabled: nudgeRaw.enabled === true,
      delaySeconds:
        typeof nudgeRaw.delaySeconds === "number" &&
        Number.isInteger(nudgeRaw.delaySeconds) &&
        nudgeRaw.delaySeconds >= 5 &&
        nudgeRaw.delaySeconds <= 300
          ? nudgeRaw.delaySeconds
          : 15,
      text: typeof nudgeRaw.text === "string" ? nudgeRaw.text.slice(0, 120) : "",
      mode: nudgeRaw.mode === "once-per-day" ? "once-per-day" : "once-per-load",
    };

    return {
      version: version,
      number: number,
      greeting: { open: greetingOpen, closed: greetingClosed },
      presets: presetsOf(raw.presetMessages),
      position: position,
      color: color,
      size: size,
      hours: {
        enabled: hours.enabled === true,
        timezone: bounded(hours.timezone, 64),
        openNow: hours.openNow === true,
        onHoliday: hours.onHoliday === true,
        holidayLabel: bounded(hours.holidayLabel, 60),
        openLabel: bounded(hours.openLabel, 60),
        closedLabel: bounded(hours.closedLabel, 60),
        closedExtra: bounded(hours.closedExtra, 120),
        nextLabel: bounded(hours.nextLabel, 40),
        summary: bounded(hours.summary, 200),
        openColor:
          typeof hours.openColor === "string" && HEX_COLOR_RE.test(hours.openColor)
            ? hours.openColor.toLowerCase()
            : "",
        closedColor:
          typeof hours.closedColor === "string" && HEX_COLOR_RE.test(hours.closedColor)
            ? hours.closedColor.toLowerCase()
            : "",
      },
      strings: pickStrings(raw.strings),
      agent: { name: agentName, role: agentRole, photoUrl: photoUrl },
      departments: departments,
      catalogUrl: catalogUrl,
      lead: lead,
      utm: raw.utm === true,
      analyticsPages: raw.analyticsPages === true,
      nudge: nudge,
      analytics: raw.analytics !== false,
    };
  }

  /**
   * Bounded quick-reply list: non-empty lines only, at most six, each trimmed
   * and capped, mirroring `splitPresetMessages` in `src/settings.ts`.
   *
   * @param {unknown} raw
   * @returns {string[]}
   */
  function presetsOf(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_PRESETS; i += 1) {
      var line = typeof raw[i] === "string" ? raw[i].trim() : "";
      if (line.length > 0) out.push(line.slice(0, MAX_PRESET_LENGTH));
    }
    return out;
  }

  /**
   * Fire-and-forget counter. Failures are swallowed on purpose: analytics must
   * never interrupt a visitor who is trying to send a message. A send may name
   * the department chip the visitor chose; an open may name the page path —
   * but only when the operator opted into page counting, and only the path,
   * never a query string.
   *
   * `keepalive` is what lets the request outlive the page, so the older
   * `navigator.sendBeacon` fallback is unnecessary — and it would have sent
   * cookies this call deliberately omits.
   *
   * @param {string} event
   * @param {number} [departmentIndex]
   * @param {string} [page]
   */
  function beacon(event, departmentIndex, page) {
    if (!currentConfig || !currentConfig.analytics) return;
    var url = ANALYTICS_URL + "?event=" + encodeURIComponent(event);
    if (typeof departmentIndex === "number") {
      url += "&dept=" + encodeURIComponent(String(departmentIndex));
    }
    if (typeof page === "string" && page.length > 0) {
      url += "&page=" + encodeURIComponent(page);
    }
    try {
      // No body → no Content-Type → CORS simple request, so no preflight.
      fetch(url, { method: "POST", keepalive: true, credentials: "omit" }).catch(function () {});
    } catch (err) {
      /* ignore */
    }
  }

  /**
   * The number the chat opens with: the selected department's when chips are
   * shown, else the site's main number.
   */
  function targetNumber() {
    if (!currentConfig) return "";
    var departments = currentConfig.departments || [];
    if (departments.length >= 2 && currentDept >= 0 && currentDept < departments.length) {
      return departments[currentDept].number;
    }
    return currentConfig.number;
  }

  /** The structured lead header, "" when the form is off or unfilled. */
  function leadHeader() {
    if (!currentConfig || !currentConfig.lead.enabled) return "";
    var name = leadNameEl ? leadNameEl.value.trim() : "";
    var interest = leadInterestEl ? leadInterestEl.value : "";
    var parts = [];
    if (name.length > 0) parts.push(STR.leadNameLabel + ": " + name);
    if (interest.length > 0) parts.push(STR.leadInterestLabel + ": " + interest);
    if (parts.length === 0) return "";
    return parts.join("\n") + "\n\n";
  }

  /** The `wa.me` deep link for whatever is in the message box right now. */
  function waHref() {
    var text = messageEl ? messageEl.value.trim() : "";
    text = leadHeader() + text + utmFooter();
    var base = "https://wa.me/" + targetNumber();
    return text.length > 0 ? base + "?text=" + encodeURIComponent(text) : base;
  }

  /**
   * The page's UTM tags, appended to the prefilled message when the operator
   * turned propagation on. The tags come from the visitor's own URL and ride
   * inside their own message; the plugin stores nothing.
   */
  function utmFooter() {
    if (!currentConfig || !currentConfig.utm) return "";
    var params = null;
    try {
      params = new URLSearchParams(window.location.search || "");
    } catch (err) {
      return "";
    }
    var parts = [];
    ["utm_source", "utm_medium", "utm_campaign"].forEach(function (name) {
      var value = params.get(name);
      if (value) parts.push(value);
    });
    if (parts.length === 0) return "";
    return "\n\nSource: " + parts.join("/");
  }

  /** Which greeting this config shows: closed wording only when closed. */
  function greetingText(config) {
    var closed = config.hours.enabled && config.hours.openNow !== true;
    return closed ? config.greeting.closed : config.greeting.open;
  }

  function syncSendLink() {
    if (sendEl) sendEl.setAttribute("href", waHref());
  }

  function whatsappIcon() {
    var svg = svgEl("svg", {
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      focusable: "false",
      class: "jwa-fab__icon",
    });
    svg.appendChild(
      svgEl("path", {
        fill: "currentColor",
        d: WHATSAPP_PATH,
      }),
    );
    return svg;
  }

  function buildFab() {
    var button = el("button", "jwa-fab");
    button.type = "button";
    button.setAttribute("aria-label", STR.fabLabel);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", PANEL_ID);
    button.appendChild(whatsappIcon());
    button.addEventListener("click", function () {
      if (panel && !panel.hidden) closePanel();
      else openPanel();
    });
    return button;
  }

  function buildPanel(config) {
    var box = el("div", "jwa-panel");
    box.id = PANEL_ID;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "jwa-title");
    box.hidden = true;

    var header = el("div", "jwa-panel__header");

    /**
     * The operator's photo when one is configured, otherwise the emoji
     * glyph. The photo is assigned to `img.src` (never markup) and the URL
     * was allow-listed twice: on the server and again in normalizeConfig.
     */
    var avatar;
    if (config.agent.photoUrl) {
      avatar = el("img", "jwa-panel__avatar jwa-panel__avatar--photo");
      avatar.src = config.agent.photoUrl;
      avatar.alt = "";
    } else {
      avatar = el("span", "jwa-panel__avatar", STR.avatarGlyph);
    }
    avatar.setAttribute("aria-hidden", "true");

    var heading = el("div", "jwa-panel__heading");
    var title = el("p", "jwa-panel__title", config.agent.name || STR.panelTitle);
    title.id = "jwa-title";
    agentTitleEl = title;
    heading.appendChild(title);
    if (config.agent.role) {
      agentRoleEl = el("p", "jwa-panel__role", config.agent.role);
      heading.appendChild(agentRoleEl);
    }
    statusEl = el("p", "jwa-panel__status");
    heading.appendChild(statusEl);
    statusExtraEl = el("p", "jwa-panel__status-extra");
    statusExtraEl.hidden = true;
    heading.appendChild(statusExtraEl);

    var close = el("button", "jwa-panel__close", STR.closeLabel);
    close.type = "button";
    close.setAttribute("aria-label", STR.closeAriaLabel);
    close.addEventListener("click", closePanel);

    header.appendChild(avatar);
    header.appendChild(heading);
    header.appendChild(close);

    var body = el("div", "jwa-panel__body");
    welcomeEl = el("p", "jwa-panel__welcome", greetingText(config));
    body.appendChild(welcomeEl);

    if (config.departments.length >= 2) {
      deptRowEl = el("div", "jwa-panel__departments");
      deptRowEl.setAttribute("role", "group");
      deptRowEl.setAttribute("aria-label", STR.departmentsAriaLabel);
      config.departments.forEach(function (dept, index) {
        var chip = el(
          "button",
          "jwa-dept" + (index === currentDept ? " jwa-dept--on" : ""),
          (dept.icon ? dept.icon + " " : "") + dept.name,
        );
        chip.type = "button";
        chip.addEventListener("click", function () {
          currentDept = index;
          markDeptChips();
          syncSendLink();
        });
        deptRowEl.appendChild(chip);
      });
      body.appendChild(deptRowEl);
    }

    if (config.catalogUrl) {
      var links = el("div", "jwa-panel__links");
      var catalog = el("a", "jwa-catalog", STR.catalogLabel);
      catalog.href = config.catalogUrl;
      catalog.target = "_blank";
      catalog.rel = "noopener noreferrer";
      links.appendChild(catalog);
      body.appendChild(links);
    }

    if (config.presets.length > 0) {
      var presets = el("div", "jwa-panel__presets");
      presets.setAttribute("role", "group");
      presets.setAttribute("aria-label", STR.presetsAriaLabel);
      config.presets.forEach(function (text) {
        var chip = el("button", "jwa-preset", text);
        chip.type = "button";
        chip.addEventListener("click", function () {
          // A quick reply is a choice, so it replaces whatever was typed.
          messageEl.value = text;
          syncSendLink();
          beacon("preset");
          messageEl.focus();
        });
        presets.appendChild(chip);
      });
      body.appendChild(presets);
    }

    if (config.lead.enabled) {
      body.appendChild(buildLeadForm(config));
    }

    var label = el("label", "jwa-visually-hidden", STR.messageLabel);
    label.setAttribute("for", MESSAGE_ID);

    messageEl = el("textarea", "jwa-message");
    messageEl.id = MESSAGE_ID;
    messageEl.rows = 3;
    messageEl.maxLength = 1000;
    messageEl.placeholder = STR.messagePlaceholder;
    messageEl.value = greetingText(config);
    messageEl.addEventListener("input", syncSendLink);

    body.appendChild(label);
    body.appendChild(messageEl);

    var footer = el("div", "jwa-panel__footer");
    sendEl = el("a", "jwa-send");
    sendEl.href = waHref();
    sendEl.target = "_blank";
    sendEl.rel = "noopener noreferrer";
    sendEl.appendChild(el("span", null, config.lead.enabled ? STR.leadContinueLabel : STR.sendLabel));
    sendEl.addEventListener("click", function (event) {
      if (currentConfig && currentConfig.lead.enabled) {
        if (!leadFormValid()) {
          event.preventDefault();
          showLeadError();
          return;
        }
        beacon("lead");
      }
      var departments = currentConfig ? currentConfig.departments : [];
      if (departments.length >= 2) {
        beacon("send", currentDept);
      } else {
        beacon("send");
      }
    });
    footer.appendChild(sendEl);

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    return box;
  }

  /** The selected department chip is the one that is on. */
  function markDeptChips() {
    if (!deptRowEl) return;
    Array.prototype.forEach.call(deptRowEl.children, function (chip, index) {
      chip.className = "jwa-dept" + (index === currentDept ? " jwa-dept--on" : "");
    });
  }

  /**
   * The optional pre-chat lead form: name, optional interest, and a consent
   * checkbox. Nothing here is stored — on Continue the values ride inside the
   * visitor's own WhatsApp message.
   */
  function buildLeadForm(config) {
    var box = el("div", "jwa-panel__lead");

    var nameLabel = el("label", "jwa-visually-hidden", STR.leadNameLabel);
    nameLabel.setAttribute("for", "jwa-lead-name");
    leadNameEl = el("input", "jwa-lead__name");
    leadNameEl.id = "jwa-lead-name";
    leadNameEl.type = "text";
    leadNameEl.maxLength = 80;
    leadNameEl.placeholder = STR.leadNameLabel;
    leadNameEl.addEventListener("input", function () {
      syncSendLink();
      clearLeadError();
    });
    box.appendChild(nameLabel);
    box.appendChild(leadNameEl);

    if (config.lead.interests.length > 0) {
      var interestLabel = el("label", "jwa-visually-hidden", STR.leadInterestLabel);
      interestLabel.setAttribute("for", "jwa-lead-interest");
      leadInterestEl = el("select", "jwa-lead__interest");
      leadInterestEl.id = "jwa-lead-interest";
      var emptyOption = el("option", null, STR.leadInterestLabel);
      emptyOption.value = "";
      leadInterestEl.appendChild(emptyOption);
      config.lead.interests.forEach(function (interest) {
        var option = el("option", null, interest);
        option.value = interest;
        leadInterestEl.appendChild(option);
      });
      leadInterestEl.addEventListener("change", function () {
        syncSendLink();
      });
      box.appendChild(interestLabel);
      box.appendChild(leadInterestEl);
    }

    var consentLabel = el("label", "jwa-lead__consent");
    leadConsentEl = el("input", "jwa-lead__consent-check");
    leadConsentEl.type = "checkbox";
    leadConsentEl.addEventListener("change", function () {
      syncSendLink();
      clearLeadError();
    });
    consentLabel.appendChild(leadConsentEl);
    consentLabel.appendChild(el("span", null, config.lead.consentText));
    box.appendChild(consentLabel);

    leadErrorEl = el("p", "jwa-lead__error");
    leadErrorEl.setAttribute("role", "alert");
    leadErrorEl.hidden = true;
    box.appendChild(leadErrorEl);

    return box;
  }

  function leadFormValid() {
    var name = leadNameEl ? leadNameEl.value.trim() : "";
    var consented = leadConsentEl ? leadConsentEl.checked : false;
    return name.length > 0 && consented;
  }

  function showLeadError() {
    if (!leadErrorEl) return;
    var name = leadNameEl ? leadNameEl.value.trim() : "";
    leadErrorEl.textContent = name.length > 0 ? STR.leadConsentRequired : STR.leadNameInvalid;
    leadErrorEl.hidden = false;
  }

  function clearLeadError() {
    if (leadErrorEl) leadErrorEl.hidden = true;
  }

  /* ------------------------------------------------------------- nudge */

  /** The visitor's local date, for the once-per-day dismissal flag. */
  function nudgeToday() {
    var now = new Date();
    return (
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0")
    );
  }

  function nudgeDismissedToday() {
    try {
      if (typeof localStorage === "undefined") return false;
      return localStorage.getItem(NUDGE_KEY) === nudgeToday();
    } catch (err) {
      return false;
    }
  }

  /**
   * Arm the teaser. The only stored value this widget ever writes is the
   * once-per-day dismissal date, and only when the operator picked that mode.
   */
  function scheduleNudge(config) {
    if (!config.nudge.enabled) return;
    if (config.nudge.mode === "once-per-day" && nudgeDismissedToday()) {
      nudgeState = "skipped";
      return;
    }
    nudgeTimer = setTimeout(function () {
      if (nudgeState !== "pending") return;
      /** Annoyance budget: someone who already opened the panel needs no nudge. */
      if (panelOpened) {
        nudgeState = "skipped";
        return;
      }
      showNudge(config);
    }, config.nudge.delaySeconds * 1000);
  }

  function showNudge(config) {
    if (!root || !fab || nudgeEl) return;
    nudgeEl = el("div", "jwa-nudge");
    nudgeEl.setAttribute("role", "status");
    nudgeEl.setAttribute("aria-live", "polite");
    nudgeEl.appendChild(el("span", "jwa-nudge__text", config.nudge.text || STR.nudgeDefault));
    var close = el("button", "jwa-nudge__close", STR.closeLabel);
    close.type = "button";
    close.setAttribute("aria-label", STR.nudgeCloseLabel);
    close.addEventListener("click", function (event) {
      event.stopPropagation();
      dismissNudge(config);
    });
    nudgeEl.appendChild(close);
    nudgeEl.addEventListener("click", function () {
      dismissNudge(config);
      openPanel();
    });
    root.insertBefore(nudgeEl, fab);
    nudgeState = "shown";
  }

  function dismissNudge(config) {
    nudgeState = "dismissed";
    if (nudgeEl && nudgeEl.parentNode) nudgeEl.parentNode.removeChild(nudgeEl);
    nudgeEl = null;
    if (config.nudge.mode === "once-per-day") {
      try {
        localStorage.setItem(NUDGE_KEY, nudgeToday());
      } catch (err) {
        /** Private browsing: the flag simply does not persist. */
      }
    }
  }

  /**
   * The status line: the operator's open wording when open, or — when closed
   * — the holiday label, the operator's custom closed text, the
   * server-computed "opens at" line, or the plain closed wording, in that
   * order. The tooltip is the schedule summary, and a second line shows when
   * the operator set one.
   */
  function renderStatus(config) {
    if (!statusEl) return;
    var hours = config.hours;
    if (hours.enabled) {
      var text;
      if (hours.openNow) text = hours.openLabel || STR.statusOpen;
      else if (hours.onHoliday && hours.holidayLabel) text = hours.holidayLabel;
      else if (hours.closedLabel) text = hours.closedLabel;
      else if (hours.nextLabel) text = STR.statusClosedNext.replace("{next}", hours.nextLabel);
      else text = STR.statusClosed;
      statusEl.textContent = text;
      statusEl.setAttribute("data-state", hours.openNow ? "open" : "closed");
      statusEl.title = hours.summary || "";
      renderStatusExtra(config);
      return;
    }
    statusEl.textContent = STR.statusIdle;
    statusEl.setAttribute("data-state", "idle");
    statusEl.title = "";
    renderStatusExtra(null);
  }

  function renderStatusExtra(config) {
    if (!statusExtraEl) return;
    var show =
      config !== null &&
      config.hours.enabled === true &&
      config.hours.openNow !== true &&
      config.hours.closedExtra.length > 0;
    statusExtraEl.hidden = !show;
    if (show) statusExtraEl.textContent = config.hours.closedExtra;
  }

  /**
   * Refresh the copy that may drift on a re-sync: the greeting (open/closed
   * wording), the agent header, and the status line. The message box and the
   * quick replies are deliberately left alone so a re-sync never overwrites
   * text someone is halfway through typing. The avatar photo is set once at
   * mount; changing it mid-session applies on the next page load.
   */
  function renderHeader(config) {
    if (welcomeEl) welcomeEl.textContent = greetingText(config);
    if (agentTitleEl) agentTitleEl.textContent = config.agent.name || STR.panelTitle;
    if (agentRoleEl) {
      if (config.agent.role) {
        agentRoleEl.textContent = config.agent.role;
        agentRoleEl.hidden = false;
      } else {
        agentRoleEl.hidden = true;
      }
    }
    renderStatus(config);
  }

  /** First element a visitor can tab to inside the panel. */
  function focusables() {
    if (!panel) return [];
    var nodes = panel.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    return Array.prototype.filter.call(nodes, function (node) {
      return node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement;
    });
  }

  function onDocumentKeydown(event) {
    if (!panel || panel.hidden) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key !== "Tab") return;

    var list = focusables();
    if (list.length === 0) return;
    var first = list[0];
    var last = list[list.length - 1];
    var active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function onDocumentPointerDown(event) {
    if (!root || !panel || panel.hidden) return;
    var target = event.target;
    if (target && !root.contains(target)) closePanel();
  }

  /** The page path, "" when unavailable or when page counting is off. */
  function pagePathForAnalytics() {
    if (!currentConfig || !currentConfig.analyticsPages) return "";
    try {
      var path = window.location && window.location.pathname ? window.location.pathname : "";
      return path.slice(0, 200);
    } catch (err) {
      return "";
    }
  }

  function openPanel() {
    if (!panel || !fab) return;
    /** Annoyance budget: a manual open ends any pending or shown nudge. */
    panelOpened = true;
    if (nudgeState === "pending") nudgeState = "skipped";
    if (nudgeState === "shown") dismissNudge(currentConfig);
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onDocumentKeydown);
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    if (messageEl) messageEl.focus();
    beacon("open", undefined, pagePathForAnalytics());
  }

  function closePanel() {
    if (!panel || !fab || panel.hidden) return;
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onDocumentKeydown);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    fab.focus();
    beacon("close");
  }

  /**
   * Size and corner come from `data-*` attributes so the stylesheet stays the
   * single source of their values; only the operator-chosen colour has to be
   * written inline, because it is not knowable ahead of time.
   */
  function applyVisuals(config) {
    if (!root) return;
    root.setAttribute("data-position", config.position);
    root.setAttribute("data-size", config.size);
    root.style.setProperty("--jwa-color", config.color);
    if (config.hours.openColor) {
      root.style.setProperty("--jwa-status-open", config.hours.openColor);
    } else {
      root.style.removeProperty("--jwa-status-open");
    }
    if (config.hours.closedColor) {
      root.style.setProperty("--jwa-status-closed", config.hours.closedColor);
    } else {
      root.style.removeProperty("--jwa-status-closed");
    }
  }

  function mount(config) {
    root = el("div", "jwa-root");
    root.setAttribute("data-position", config.position);
    root.setAttribute("data-size", config.size);

    panel = buildPanel(config);
    fab = buildFab();

    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);

    applyVisuals(config);
    renderHeader(config);
    syncSendLink();
    scheduleNudge(config);
  }

  /** Tear the widget down — used when a re-sync reports it was switched off. */
  function unmount() {
    if (resyncTimer) {
      clearInterval(resyncTimer);
      resyncTimer = 0;
    }
    if (panel && !panel.hidden) closePanel();
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    panel = null;
    fab = null;
    statusEl = null;
    statusExtraEl = null;
    welcomeEl = null;
    agentTitleEl = null;
    agentRoleEl = null;
    messageEl = null;
    sendEl = null;
    deptRowEl = null;
    leadNameEl = null;
    leadInterestEl = null;
    leadConsentEl = null;
    leadErrorEl = null;
    if (nudgeTimer) {
      clearTimeout(nudgeTimer);
      nudgeTimer = 0;
    }
    nudgeEl = null;
    nudgeState = "pending";
    panelOpened = false;
    currentConfig = null;
    currentDept = 0;
    STR = STRING_FALLBACK;
  }

  /** One warning per page load: a broken config must not flood the console. */
  function warnOnce(message) {
    if (didWarn) return;
    didWarn = true;
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[brayne-whatsapp-connect] " + message);
    }
  }

  /**
   * Fetch the config. `quiet` marks the periodic re-sync, where a blip should
   * leave the already-rendered widget alone rather than warn or unmount.
   *
   * @param {boolean} quiet
   */
  function loadConfig(quiet) {
    fetch(configUrl(), { credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (raw) {
        var config = normalizeConfig(raw);
        if (!config) {
          // Disabled, or no valid number: the widget must not be on the page.
          if (currentConfig) unmount();
          return;
        }

        currentConfig = config;
        STR = config.strings;

        if (!root) {
          mount(config);
          if (config.hours.enabled) {
            resyncTimer = setInterval(function () {
              if (document.visibilityState === "hidden") return;
              loadConfig(true);
            }, RESYNC_MS);
          }
          return;
        }

        /**
         * Already on the page: refresh only what may drift without the
         * visitor noticing — the corner, the colour, the link target, the
         * greeting, the agent header and the Open / Closed badge. The message
         * box and the quick replies are left alone so a re-sync never
         * overwrites text someone is halfway through typing.
         */
        applyVisuals(config);
        renderHeader(config);
        syncSendLink();
      })
      .catch(function (err) {
        if (quiet) return;
        warnOnce("could not load the widget config (" + String(err && err.message) + ")");
      });
  }

  function start() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    loadConfig(false);
  }

  start();
})();
