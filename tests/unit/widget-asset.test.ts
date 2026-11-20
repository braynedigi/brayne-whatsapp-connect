import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { API_NAMESPACE } from "../../src/settings.js";

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

  it("touches no cookie, storage or identifier", () => {
    expect(source).not.toMatch(/document\.cookie/);
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/sessionStorage/);
    expect(source).not.toMatch(/indexedDB/);
    expect(source).not.toMatch(/\beval\b/);
    expect(source).not.toMatch(/new Function\b/);
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
    const ids = new Set(["jwa-title"]);
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
