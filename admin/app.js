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
    "visitor.welcome": "Welcome message",
    "visitor.notSet": "Not set",
    "hours.title": "Business hours",
    "hours.open": "Open now",
    "hours.closed": "Closed",
    "hours.off": "Always available",
    "hours.offHint": "Business hours are off, so the widget never shows a closed state.",
    "settings.title": "Settings",
    "settings.save": "Save changes",
    "settings.saving": "Saving...",
    "settings.saved": "Settings saved",
    "settings.saveFailed": "Couldn't save settings - fix the highlighted field.",
    "settings.unsaved": "Unsaved changes",
    "tab.general": "General",
    "tab.message": "Message",
    "tab.appearance": "Appearance",
    "tab.hours": "Business hours",
    "tab.privacy": "Privacy",
    "field.enabled.label": "Show the WhatsApp button",
    "field.enabled.hint": "Turn the floating contact button off without uninstalling the plugin.",
    "field.whatsappNumber.label": "WhatsApp number",
    "field.whatsappNumber.hint":
      "International format without spaces or brackets, e.g. 15551234567 or +233201234567. Leave empty to hide the button.",
    "field.whatsappNumber.invalid":
      "Enter digits only, 7 to 15 characters, optionally starting with +.",
    "field.welcomeMessage.label": "Welcome message",
    "field.welcomeMessage.hint": "Prefills the chat when a visitor opens the button.",
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
    { id: "hours", labelKey: "tab.hours" },
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
    defs.appendChild(h("dt", { text: t("visitor.welcome") }));
    defs.appendChild(h("dd", { text: widget.welcomeMessage }));

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
              [widget.hours.openNow ? t("hours.open") : t("hours.closed")],
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
    var days = t("option.days." + daysKey(widget.hours.days));
    return days + ", " + widget.hours.open + " - " + widget.hours.close;
  }

  /** Day numbers back to the schema key that named them (0 = Sunday). */
  function daysKey(days) {
    var sets = {
      weekdays: [1, 2, 3, 4, 5],
      "mon-sat": [1, 2, 3, 4, 5, 6],
      daily: [0, 1, 2, 3, 4, 5, 6],
    };
    var have = (days || []).slice().sort().join(",");
    var keys = Object.keys(sets);
    for (var index = 0; index < keys.length; index += 1) {
      if (sets[keys[index]].join(",") === have) return keys[index];
    }
    return "weekdays";
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
      hours: renderTabHours,
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
    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.general") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        checkrowNode("enabled", "field.enabled.label", "field.enabled.hint"),
        labeledInput("whatsappNumber", "field.whatsappNumber.label", "field.whatsappNumber.hint", {
          placeholder: "+233201234567",
        }),
      ]),
    ]);
  }

  function renderTabMessage() {
    return h("section", { class: "jwa-card" }, [
      h("div", { class: "jwa-card__head" }, [
        h("h2", { class: "jwa-card__title", text: t("tab.message") }),
      ]),
      h("div", { class: "jwa-card__body" }, [
        labeledInput("welcomeMessage", "field.welcomeMessage.label", "field.welcomeMessage.hint", {
          multiline: true,
          rows: 3,
        }),
        labeledInput("presetMessages", "field.presetMessages.label", "field.presetMessages.hint", {
          multiline: true,
          rows: 5,
          placeholder: "I'd like a quote",
        }),
      ]),
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

  function renderTabHours() {
    var days = h(
      "div",
      { class: "jwa-tiles", role: "radiogroup", "aria-label": t("field.businessDays.label") },
      [
        tileOption("businessDays", "weekdays", "option.days.weekdays"),
        tileOption("businessDays", "mon-sat", "option.days.mon-sat"),
        tileOption("businessDays", "daily", "option.days.daily"),
      ],
    );

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
        h("div", { class: "jwa-field" }, [
          h("span", { class: "jwa-field__label", text: t("field.businessDays.label") }),
          days,
        ]),
        h("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px" }, [
          labeledInput("businessOpenTime", "field.businessOpenTime.label", "field.clock.hint", {
            placeholder: "09:00",
          }),
          labeledInput("businessCloseTime", "field.businessCloseTime.label", "field.clock.hint", {
            placeholder: "17:00",
          }),
        ]),
        fieldError("businessOpenTime", "field.clock.invalid"),
        fieldError("businessCloseTime", "field.clock.invalid"),
        h("div", { class: "jwa-field" }, [
          h("label", {
            class: "jwa-field__label",
            for: "jwa-field-businessTimezone",
            text: t("field.businessTimezone.label"),
          }),
          zones,
          h("p", { class: "jwa-field__hint", text: t("field.businessTimezone.hint") }),
        ]),
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
    if (!clockLooksValid(state.form.businessOpenTime || "09:00")) {
      errors.businessOpenTime = t("field.clock.invalid");
    }
    if (!clockLooksValid(state.form.businessCloseTime || "17:00")) {
      errors.businessCloseTime = t("field.clock.invalid");
    }
    if (!presetsLookValid(state.form.presetMessages || "")) {
      errors.presetMessages = t("field.presetMessages.invalid");
    }
    return errors;
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
