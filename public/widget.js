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

  var DEFAULT_COLOR = "#25d366";
  var HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  var NUMBER_RE = /^\d{7,15}$/;
  var CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  var MAX_PRESETS = 6;
  var MAX_PRESET_LENGTH = 200;
  var MAX_WELCOME_LENGTH = 500;

  /** Re-read the config this often so the Open / Closed badge cannot go stale. */
  var RESYNC_MS = 5 * 60 * 1000;

  var WHATSAPP_PATH =
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z";

  /** The last config accepted from the server; `null` until one arrives. */
  var currentConfig = null;
  var root = null;
  var panel = null;
  var fab = null;
  var statusEl = null;
  var messageEl = null;
  var sendEl = null;
  var resyncTimer = 0;
  var didWarn = false;

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
   * Coerce whatever the config endpoint returned into the exact shape the
   * renderer trusts. The server already normalises; this repeats the checks
   * because the value is about to become a `wa.me` link and an inline CSS
   * custom property, and a second opinion costs nothing.
   *
   * @param {unknown} raw
   * @returns {null | {
   *   number: string,
   *   welcome: string,
   *   presets: string[],
   *   position: "bottom-right" | "bottom-left",
   *   color: string,
   *   size: "small" | "medium" | "large",
   *   hours: { enabled: boolean, open: string, close: string, days: number[], openNow: boolean },
   *   analytics: boolean
   * }}
   */
  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object") return null;

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
    var days = Array.isArray(hours.days)
      ? hours.days.filter(function (day) {
          return typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6;
        })
      : [];

    return {
      number: number,
      welcome:
        typeof raw.welcomeMessage === "string"
          ? raw.welcomeMessage.slice(0, MAX_WELCOME_LENGTH)
          : "",
      presets: presetsOf(raw.presetMessages),
      position: position,
      color: color,
      size: size,
      hours: {
        enabled: hours.enabled === true,
        open: typeof hours.open === "string" && CLOCK_RE.test(hours.open) ? hours.open : "09:00",
        close:
          typeof hours.close === "string" && CLOCK_RE.test(hours.close) ? hours.close : "17:00",
        days: days,
        openNow: hours.openNow === true,
      },
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
   * "Mon–Fri", "Every day", or an explicit list — the same day sets the
   * server's `DAY_SETS` knows about.
   *
   * @param {number[]} days
   * @returns {string}
   */
  function daysLabel(days) {
    if (!days.length) return "";
    var sorted = days.slice().sort(function (a, b) {
      return a - b;
    });
    var key = sorted.join(",");
    if (key === "1,2,3,4,5") return "Mon–Fri";
    if (key === "1,2,3,4,5,6") return "Mon–Sat";
    if (key === "0,1,2,3,4,5,6") return "Every day";
    var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return sorted
      .map(function (day) {
        return names[day] || "";
      })
      .filter(Boolean)
      .join(", ");
  }

  /**
   * Fire-and-forget counter. Failures are swallowed on purpose: analytics must
   * never interrupt a visitor who is trying to send a message.
   *
   * `keepalive` is what lets the request outlive the page, so the older
   * `navigator.sendBeacon` fallback is unnecessary — and it would have sent
   * cookies this call deliberately omits.
   *
   * @param {string} event
   */
  function beacon(event) {
    if (!currentConfig || !currentConfig.analytics) return;
    var url = ANALYTICS_URL + "?event=" + encodeURIComponent(event);
    try {
      // No body → no Content-Type → CORS simple request, so no preflight.
      fetch(url, { method: "POST", keepalive: true, credentials: "omit" }).catch(function () {});
    } catch (err) {
      /* ignore */
    }
  }

  /** The `wa.me` deep link for whatever is in the message box right now. */
  function waHref() {
    var text = messageEl ? messageEl.value.trim() : "";
    var base = "https://wa.me/" + currentConfig.number;
    return text.length > 0 ? base + "?text=" + encodeURIComponent(text) : base;
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
    button.setAttribute("aria-label", "Chat with us on WhatsApp");
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

    var avatar = el("span", "jwa-panel__avatar", "💬");
    avatar.setAttribute("aria-hidden", "true");

    var heading = el("div", "jwa-panel__heading");
    var title = el("p", "jwa-panel__title", "Chat with us");
    title.id = "jwa-title";
    heading.appendChild(title);
    statusEl = el("p", "jwa-panel__status");
    heading.appendChild(statusEl);

    var close = el("button", "jwa-panel__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close chat panel");
    close.addEventListener("click", closePanel);

    header.appendChild(avatar);
    header.appendChild(heading);
    header.appendChild(close);

    var body = el("div", "jwa-panel__body");
    body.appendChild(el("p", "jwa-panel__welcome", config.welcome));

    if (config.presets.length > 0) {
      var presets = el("div", "jwa-panel__presets");
      presets.setAttribute("role", "group");
      presets.setAttribute("aria-label", "Quick replies");
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

    var label = el("label", "jwa-visually-hidden", "Your message");
    label.setAttribute("for", MESSAGE_ID);

    messageEl = el("textarea", "jwa-message");
    messageEl.id = MESSAGE_ID;
    messageEl.rows = 3;
    messageEl.maxLength = 1000;
    messageEl.placeholder = "Type a message…";
    messageEl.value = config.welcome;
    messageEl.addEventListener("input", syncSendLink);

    body.appendChild(label);
    body.appendChild(messageEl);

    var footer = el("div", "jwa-panel__footer");
    sendEl = el("a", "jwa-send");
    sendEl.href = waHref();
    sendEl.target = "_blank";
    sendEl.rel = "noopener noreferrer";
    sendEl.appendChild(el("span", null, "Send on WhatsApp"));
    sendEl.addEventListener("click", function () {
      beacon("send");
    });
    footer.appendChild(sendEl);

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    return box;
  }

  function renderStatus(config) {
    if (!statusEl) return;
    var hours = config.hours;
    if (hours.enabled) {
      statusEl.textContent = hours.openNow ? "Open now" : "Closed — messages welcome";
      statusEl.setAttribute("data-state", hours.openNow ? "open" : "closed");
      statusEl.title = daysLabel(hours.days) + " · " + hours.open + "–" + hours.close;
      return;
    }
    statusEl.textContent = "We usually reply within a few minutes.";
    statusEl.setAttribute("data-state", "idle");
    statusEl.title = "";
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

  function openPanel() {
    if (!panel || !fab) return;
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onDocumentKeydown);
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    if (messageEl) messageEl.focus();
    beacon("open");
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
    renderStatus(config);
    syncSendLink();
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
    messageEl = null;
    sendEl = null;
    currentConfig = null;
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
    fetch(CONFIG_URL, { credentials: "same-origin" })
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
         * visitor noticing — the corner, the colour, the link target and the
         * Open / Closed badge. The message box and the quick replies are left
         * alone so a re-sync never overwrites text someone is halfway
         * through typing.
         */
        applyVisuals(config);
        renderStatus(config);
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
