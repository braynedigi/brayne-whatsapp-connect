import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { API_NAMESPACE } from "../../src/settings.js";
import { STRINGS_EN } from "../../src/strings.js";

/**
 * The widget ships as plain JavaScript with no build step, so the checks here
 * are the only thing standing between a typo and a broken public page: it is
 * parsed for real, its endpoints are tied to the server's namespace, and it is
 * audited for the things a contact widget must never do.
 */

const widgetUrl = new URL("../../public/widget.js", import.meta.url);
const styleUrl = new URL("../../public/widget.css", import.meta.url);
const source = readFileSync(fileURLToPath(widgetUrl), "utf8");
const styles = readFileSync(fileURLToPath(styleUrl), "utf8");

function constant(name: string): string {
  const match = new RegExp(`var ${name} = "([^"]+)";`).exec(source);
  if (!match || match[1] === undefined) throw new Error(`${name} not found in widget.js`);
  return match[1];
}

describe("widget.js", () => {
  it("parses as JavaScript", () => {
    expect(() => new Script(source, { filename: "widget.js" })).not.toThrow();
  });

  it("is a self-invoking module with a re-entry guard", () => {
    expect(source.trimEnd().endsWith("})();")).toBe(true);
    expect(source).toContain('"use strict"');
    // The host may load the file directly *and* bundled; it must render once.
    expect(source).toContain("window[LOAD_GUARD]");
  });

  it("reads its config from the plugin's own API namespace", () => {
    expect(constant("CONFIG_URL")).toBe(`/api/${API_NAMESPACE}/config`);
    expect(constant("ANALYTICS_URL")).toBe(`/api/${API_NAMESPACE}/analytics`);
  });

  it("sends analytics as a bodyless query parameter, so no CORS preflight", () => {
    expect(source).toContain('ANALYTICS_URL + "?event="');
    // A body would force `Content-Type: application/json` and a preflight the
    // plugin router does not answer on a statically exported page.
    expect(source).not.toMatch(/\bbody\s*:/);
    expect(source).not.toMatch(/["']content-type["']\s*:/i);
    expect(source).toContain("keepalive: true");
    // Cookies carry no part of this call, so a cross-origin beacon stays simple.
    expect(source).toContain('credentials: "omit"');
  });

  it("writes config values as text, never as markup", () => {
    expect(source).not.toMatch(/\.innerHTML\b/);
    expect(source).not.toMatch(/\.outerHTML\b/);
    expect(source).not.toMatch(/insertAdjacentHTML/);
    expect(source).not.toMatch(/document\.write\b/);
    expect(source).toContain("node.textContent = String(text)");
  });

  it("touches no cookie, identifier, or storage beyond the nudge flag", () => {
    expect(source).not.toMatch(/document\.cookie/);
    expect(source).not.toMatch(/sessionStorage/);
    expect(source).not.toMatch(/indexedDB/);
    expect(source).not.toMatch(/\beval\b/);
    expect(source).not.toMatch(/new Function\b/);
    /**
     * `localStorage` appears only as the once-per-day nudge dismissal date:
     * one getItem/setItem pair behind a try/catch, gated on the operator
     * having chosen the day mode. Nothing else may read or write it.
     */
    const storageLines = source.split("\n").filter((line) => line.includes("localStorage"));
    expect(storageLines.length).toBeGreaterThan(0);
    expect(storageLines.length).toBeLessThanOrEqual(6);
    for (const line of storageLines) {
      expect(line).toMatch(/localStorage\.(getItem|setItem)|typeof localStorage/);
    }
    expect(source).toContain('"brayne-whatsapp-connect-nudge-dismissed"');
  });

  it("only links out to wa.me", () => {
    // `https://` only: the SVG namespace is the one `http://` string in the file.
    const urls = [...source.matchAll(/https:\/\/[^\s"'`]+/g)].map((match) => match[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("https://wa.me/")).toBe(true);
    }
  });

  it("renders nothing until the server says the widget is configured", () => {
    expect(source).toContain('if (raw.enabled !== true || number === "") return null;');
    // The operator can turn it off, and a failed config fetch must not render.
    expect(source).toContain("if (currentConfig) unmount();");
    expect(source).toContain("warnOnce(");
  });

  it("keeps focus inside the panel and closes on Escape", () => {
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain('setAttribute("aria-modal", "true")');
    expect(source).toContain('setAttribute("aria-expanded"');
  });
});

describe("widget.js copy and encoding", () => {
  it("pins the exact glyphs the mojibake bug once mangled", () => {
    expect(source).toContain('"💬"');
    expect(source).toContain('"×"');
    expect(source).toContain('"Type a message…"');
    expect(source).toContain('"Closed — messages welcome"');
    expect(source).toContain('"Mon–Fri"');
    expect(source).toContain('" · "');
    expect(source).toContain('"–"');
  });

  it("ships the same English fallback catalog as the server", () => {
    for (const [key, value] of Object.entries(STRINGS_EN)) {
      if (Array.isArray(value)) continue;
      // `key: "value"` as it appears in the STRING_FALLBACK table.
      expect(source).toContain(`${key}: ${JSON.stringify(value)}`);
    }
    expect(source).toContain("dayNames: [");
    expect(source).toContain('"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"');
  });

  it("gates the config payload version at ≥ 1", () => {
    expect(source).toContain("raw.version === undefined ? 1 : raw.version");
    expect(source).toContain("version < 1");
    expect(source).toContain("version: version");
  });

  it("falls back per key when the config strings are hostile", () => {
    expect(source).toContain("typeof values[key] === \"string\" ? values[key] : STRING_FALLBACK[key]");
    expect(source).toContain("days.length === 7 ? days : STRING_FALLBACK.dayNames");
  });

  it("contains no mojibake signatures", () => {
    const signatures = [
      "\u00E2\u20AC",
      "\u00E2\u2020",
      "\u00E2\u201D\u20AC",
      "\u00C3\u2014",
      "\u00F0\u0178",
      "\u00C2\u00B7",
      "\uFFFD",
    ];
    for (const signature of signatures) {
      expect(source).not.toContain(signature);
      expect(styles).not.toContain(signature);
    }
  });
});

describe("widget.js stage 1", () => {
  it("sends the page path and browser language on the config fetch", () => {
    expect(source).toContain('CONFIG_URL + "?page="');
    expect(source).toContain('"&lang="');
    expect(source).toContain("window.location.pathname");
    expect(source).toContain("navigator.language");
  });

  it("picks the greeting by the open/closed state", () => {
    expect(source).toContain("greetingText(");
    expect(source).toContain("config.greeting.closed");
    expect(source).toContain("config.greeting.open");
    expect(source).toContain("messageEl.value = greetingText(config)");
  });

  it("renders the agent header from validated fields", () => {
    expect(source).toContain('el("img", "jwa-panel__avatar jwa-panel__avatar--photo")');
    expect(source).toContain("config.agent.name || STR.panelTitle");
    expect(source).toContain('el("p", "jwa-panel__role"');
  });

  it("appends UTM tags only when the operator opted in", () => {
    expect(source).toContain('if (!currentConfig || !currentConfig.utm) return "";');
    expect(source).toContain('["utm_source", "utm_medium", "utm_campaign"]');
    expect(source).toContain('return "\\n\\nSource: "');
  });

  it("falls back to the legacy welcome message when the greeting is missing", () => {
    expect(source).toContain("legacyWelcome");
    expect(source).toContain('typeof greeting.open === "string" ? greeting.open.slice(0, MAX_WELCOME_LENGTH) : legacyWelcome');
  });
});

describe("widget.js stage 2", () => {
  it("renders the closed badge with the stage-2 precedence", () => {
    expect(source).toContain("if (hours.openNow) text = hours.openLabel || STR.statusOpen;");
    expect(source).toContain(
      'else if (hours.onHoliday && hours.holidayLabel) text = hours.holidayLabel;',
    );
    expect(source).toContain("else if (hours.closedLabel) text = hours.closedLabel;");
    expect(source).toContain('STR.statusClosedNext.replace("{next}", hours.nextLabel)');
    expect(source).toContain('statusEl.title = hours.summary || "";');
  });

  it("renders the extra closed line when the operator set one", () => {
    expect(source).toContain('el("p", "jwa-panel__status-extra")');
    expect(source).toContain("config.hours.closedExtra.length > 0");
  });

  it("applies the badge colours as CSS custom properties", () => {
    expect(source).toContain('setProperty("--jwa-status-open"');
    expect(source).toContain('setProperty("--jwa-status-closed"');
    expect(source).toContain('removeProperty("--jwa-status-open")');
    expect(styles).toContain("var(--jwa-status-open, #12a150)");
    expect(styles).toContain("var(--jwa-status-closed, #b45309)");
  });

  it("bounds every server-provided hours string", () => {
    expect(source).toContain("bounded(hours.openLabel, 60)");
    expect(source).toContain("bounded(hours.closedLabel, 60)");
    expect(source).toContain("bounded(hours.closedExtra, 120)");
    expect(source).toContain("bounded(hours.nextLabel, 40)");
    expect(source).toContain("bounded(hours.summary, 200)");
  });
});

describe("widget.js stage 3", () => {
  it("renders department chips that swap the wa.me target", () => {
    expect(source).toContain('el("div", "jwa-panel__departments")');
    expect(source).toContain("departments[currentDept].number");
    expect(source).toContain("markDeptChips()");
    expect(source).toContain('beacon("send", currentDept)');
    expect(source).toContain('"&dept="');
  });

  it("renders the catalog chip from the allow-listed link", () => {
    expect(source).toContain('el("a", "jwa-catalog", STR.catalogLabel)');
    expect(source).toContain('/^https:\\/\\/wa\\.me\\/c\\//.test(raw.catalogUrl)');
  });

  it("builds the lead form with consent gating", () => {
    expect(source).toContain('el("div", "jwa-panel__lead")');
    expect(source).toContain("leadFormValid()");
    expect(source).toContain('beacon("lead")');
    expect(source).toContain("STR.leadContinueLabel");
    expect(source).toContain("leadConsentEl.checked");
  });

  it("composes the lead header into the visitor's own message", () => {
    expect(source).toContain('STR.leadNameLabel + ": " + name');
    expect(source).toContain('parts.join("\\n") + "\\n\\n"');
  });

  it("keeps the lead event from firing without the form", () => {
    expect(source).toContain("if (currentConfig && currentConfig.lead.enabled) {");
  });
});

describe("widget.js stage 4", () => {
  it("sends the page path on open only when page counting is on", () => {
    expect(source).toContain("pagePathForAnalytics()");
    expect(source).toContain("!currentConfig.analyticsPages");
    expect(source).toContain('beacon("open", undefined, pagePathForAnalytics())');
    expect(source).toContain('"&page=" + encodeURIComponent(page)');
    expect(source).toContain("window.location.pathname");
  });
});

describe("widget.js stage 5", () => {
  it("schedules the nudge after a bounded delay with an annoyance budget", () => {
    expect(source).toContain("scheduleNudge(config)");
    expect(source).toContain("config.nudge.delaySeconds * 1000");
    expect(source).toContain("if (panelOpened)");
    expect(source).toContain('el("div", "jwa-nudge")');
    expect(source).toContain('setAttribute("aria-live", "polite")');
  });

  it("dismisses per mode and only stores the day flag in day mode", () => {
    expect(source).toContain('config.nudge.mode === "once-per-day"');
    expect(source).toContain("nudgeDismissedToday()");
    expect(source).toContain('localStorage.setItem(NUDGE_KEY, nudgeToday())');
    expect(source).toContain("clearTimeout(nudgeTimer)");
  });

  it("clamps the nudge fields client-side too", () => {
    expect(source).toContain("nudgeRaw.delaySeconds >= 5");
    expect(source).toContain("nudgeRaw.delaySeconds <= 300");
    expect(source).toContain("nudgeRaw.text.slice(0, 120)");
  });
});

describe("widget.css", () => {
  it("has balanced braces", () => {
    const open = (styles.match(/\{/g) ?? []).length;
    const close = (styles.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
    expect(open).toBeGreaterThan(10);
  });

  it("covers dark themes, reduced motion, safe areas and print", () => {
    expect(styles).toContain("@media (prefers-color-scheme: dark)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("env(safe-area-inset-bottom");
    expect(styles).toContain("@media print");
  });

  it("styles every class the widget creates", () => {
    // `"jwa-…"` literals are class names, except the handful used as element ids.
    const ids = new Set(["jwa-title", "jwa-lead-name", "jwa-lead-interest"]);
    const tokens = [
      ...new Set([...source.matchAll(/"(jwa-[a-z0-9_-]+)"/g)].map((m) => m[1] as string)),
    ];
    expect(tokens.length).toBeGreaterThan(10);
    const unstyled = tokens.filter((token) => !ids.has(token) && !styles.includes(`.${token}`));
    expect(unstyled).toEqual([]);
  });

  it("can hide the panel that `hidden` shows as flex", () => {
    expect(styles).toMatch(/\.jwa-panel\s*\{[^}]*display:\s*flex/);
    expect(styles).toContain(".jwa-panel[hidden]");
  });

  it("keeps the widget above ordinary page chrome but below browser max", () => {
    expect(styles).toMatch(/--jwa-z:\s*(\d{4,})/);
    const z = Number(/--jwa-z:\s*(\d+)/.exec(styles)?.[1]);
    expect(z).toBeGreaterThan(1000);
    expect(z).toBeLessThan(2147483647);
  });
});
