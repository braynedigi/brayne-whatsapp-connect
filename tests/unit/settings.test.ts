import { describe, expect, it } from "vitest";
import {
  buildWidgetConfig,
  isWithinHours,
  normalizeWhatsAppNumber,
  parseClock,
  resolveColor,
  resolveDays,
  resolvePosition,
  resolveSize,
  splitPresetMessages,
  toBoolean,
  type BusinessHours,
  type RawSettings,
} from "../../src/settings.js";

/** Tuesday 17 November 2026, midday UTC — a weekday, inside 09:00–17:00. */
const TUESDAY_NOON = new Date("2026-11-17T12:00:00Z");
/** Saturday 21 November 2026, midday UTC. */
const SATURDAY_NOON = new Date("2026-11-21T12:00:00Z");

function hours(overrides: Partial<BusinessHours> = {}): BusinessHours {
  return {
    enabled: true,
    open: "09:00",
    close: "17:00",
    days: [1, 2, 3, 4, 5],
    timezone: "UTC",
    ...overrides,
  };
}

describe("normalizeWhatsAppNumber", () => {
  it("keeps a plain international number", () => {
    expect(normalizeWhatsAppNumber("233201234567")).toBe("233201234567");
  });

  it("drops the plus sign and every separator a person might type", () => {
    expect(normalizeWhatsAppNumber("+233 (0) 20-123.4567")).toBe("2330201234567");
    expect(normalizeWhatsAppNumber("+1 555 123 4567")).toBe("15551234567");
  });

  it("refuses anything that is not 7 to 15 digits", () => {
    expect(normalizeWhatsAppNumber("")).toBe("");
    expect(normalizeWhatsAppNumber("1234")).toBe("");
    expect(normalizeWhatsAppNumber("not a number")).toBe("");
    expect(normalizeWhatsAppNumber("1234567890123456")).toBe("");
    expect(normalizeWhatsAppNumber("tel:+233201234567")).toBe("");
  });

  it("refuses non-strings instead of coercing them", () => {
    expect(normalizeWhatsAppNumber(233201234567)).toBe("");
    expect(normalizeWhatsAppNumber(null)).toBe("");
    expect(normalizeWhatsAppNumber(undefined)).toBe("");
    expect(normalizeWhatsAppNumber(["233201234567"])).toBe("");
  });
});

describe("resolveColor", () => {
  it("lowercases a valid hex literal", () => {
    expect(resolveColor("#25D366", "#25D366")).toBe("#25d366");
    expect(resolveColor(" #ABC ", "#25D366")).toBe("#abc");
    expect(resolveColor("#12345678", "#25D366")).toBe("#12345678");
  });

  it("rejects anything that could escape into an inline style", () => {
    const fallback = "#25D366";
    expect(resolveColor("red", fallback)).toBe("#25d366");
    expect(resolveColor("url(javascript:alert(1))", fallback)).toBe("#25d366");
    expect(resolveColor('" onmouseover="alert(1)', fallback)).toBe("#25d366");
    expect(resolveColor("", fallback)).toBe("#25d366");
    expect(resolveColor(undefined, fallback)).toBe("#25d366");
    expect(resolveColor(0xff0000, fallback)).toBe("#25d366");
  });

  it("falls back to WhatsApp green when the fallback itself is invalid", () => {
    expect(resolveColor(null, "not-a-colour")).toBe("#25d366");
  });
});

describe("resolvePosition / resolveSize", () => {
  it("accepts only the two corners", () => {
    expect(resolvePosition("bottom-left")).toBe("bottom-left");
    expect(resolvePosition("bottom-right")).toBe("bottom-right");
    expect(resolvePosition("top-right")).toBe("bottom-right");
    expect(resolvePosition(undefined)).toBe("bottom-right");
  });

  it("maps unknown sizes to medium", () => {
    expect(resolveSize("small")).toBe("small");
    expect(resolveSize("large")).toBe("large");
    expect(resolveSize("medium")).toBe("medium");
    expect(resolveSize("huge")).toBe("medium");
    expect(resolveSize(undefined)).toBe("medium");
  });
});

describe("toBoolean", () => {
  it("treats an absent key as 'use the default', not as false", () => {
    expect(toBoolean(undefined, true)).toBe(true);
    expect(toBoolean(null, true)).toBe(true);
    expect(toBoolean("nonsense", true)).toBe(true);
    expect(toBoolean("nonsense", false)).toBe(false);
  });

  it("accepts the shapes a settings form may have written", () => {
    expect(toBoolean(true, false)).toBe(true);
    expect(toBoolean(false, true)).toBe(false);
    expect(toBoolean("true", false)).toBe(true);
    expect(toBoolean("false", true)).toBe(false);
    expect(toBoolean(1, false)).toBe(true);
    expect(toBoolean(0, true)).toBe(false);
    expect(toBoolean("1", false)).toBe(true);
    expect(toBoolean("0", true)).toBe(false);
  });
});

describe("parseClock", () => {
  it("accepts a 24-hour HH:MM", () => {
    expect(parseClock("09:00", "17:00")).toBe("09:00");
    expect(parseClock("23:59", "17:00")).toBe("23:59");
    expect(parseClock(" 09:30 ", "17:00")).toBe("09:30");
  });

  it("rejects out-of-range and malformed times", () => {
    expect(parseClock("9:00", "17:00")).toBe("17:00");
    expect(parseClock("24:00", "17:00")).toBe("17:00");
    expect(parseClock("12:60", "17:00")).toBe("17:00");
    expect(parseClock("half past nine", "17:00")).toBe("17:00");
    expect(parseClock(undefined, "17:00")).toBe("17:00");
  });

  it("degrades to midnight when even the fallback is unusable", () => {
    expect(parseClock("nope", "also-nope")).toBe("00:00");
  });
});

describe("resolveDays", () => {
  it("maps the three day sets onto JavaScript day numbers", () => {
    expect(resolveDays("weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(resolveDays("mon-sat")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(resolveDays("daily")).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("treats an unknown or missing set as weekdays", () => {
    expect(resolveDays("weekends")).toEqual([1, 2, 3, 4, 5]);
    expect(resolveDays(undefined)).toEqual([1, 2, 3, 4, 5]);
    expect(resolveDays(42)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a copy so callers cannot mutate the shared table", () => {
    const first = resolveDays("weekdays");
    first.push(6);
    expect(resolveDays("weekdays")).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("splitPresetMessages", () => {
  it("splits one message per line and drops blanks", () => {
    expect(splitPresetMessages("I'd like a quote\n\n  Are you available?  \n")).toEqual([
      "I'd like a quote",
      "Are you available?",
    ]);
  });

  it("accepts CRLF, which is what a Windows textarea submits", () => {
    expect(splitPresetMessages("one\r\ntwo")).toEqual(["one", "two"]);
  });

  it("caps the list at six and each entry at 200 characters", () => {
    const many = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
    expect(splitPresetMessages(many)).toHaveLength(6);

    const long = "x".repeat(500);
    const [first] = splitPresetMessages(long);
    expect(first).toHaveLength(200);
  });

  it("returns nothing for a non-string", () => {
    expect(splitPresetMessages(undefined)).toEqual([]);
    expect(splitPresetMessages(["a", "b"])).toEqual([]);
    expect(splitPresetMessages(7)).toEqual([]);
  });

  it("fills in the manifest default only when the key was never saved", () => {
    // `ctx.settings.get` yields undefined for a key nobody has written, while
    // an operator who cleared the textarea saves an empty string — the first
    // is an untouched install, the second a deliberate choice.
    const untouched = buildWidgetConfig({ whatsappNumber: "233201234567" }, "UTC");
    expect(untouched.presetMessages).toEqual([
      "I'd like a quote",
      "Are you available this week?",
      "Please send me your pricing",
    ]);

    const cleared = buildWidgetConfig(
      { whatsappNumber: "233201234567", presetMessages: "" },
      "UTC",
    );
    expect(cleared.presetMessages).toEqual([]);
  });
});

describe("isWithinHours", () => {
  it("is always open when the feature is off", () => {
    expect(isWithinHours(hours({ enabled: false }), TUESDAY_NOON)).toBe(true);
    expect(isWithinHours(hours({ enabled: false, open: "bad", close: "bad" }), TUESDAY_NOON)).toBe(
      true,
    );
  });

  it("is open inside the window and closed outside it, close being exclusive", () => {
    const window = hours();
    expect(isWithinHours(window, new Date("2026-11-17T08:59:00Z"))).toBe(false);
    expect(isWithinHours(window, new Date("2026-11-17T09:00:00Z"))).toBe(true);
    expect(isWithinHours(window, new Date("2026-11-17T16:59:00Z"))).toBe(true);
    expect(isWithinHours(window, new Date("2026-11-17T17:00:00Z"))).toBe(false);
  });

  it("respects the open days", () => {
    expect(isWithinHours(hours(), SATURDAY_NOON)).toBe(false);
    expect(isWithinHours(hours({ days: [0, 6] }), SATURDAY_NOON)).toBe(true);
    expect(isWithinHours(hours({ days: [0, 6] }), TUESDAY_NOON)).toBe(false);
  });

  it("reads a close at or before the open time as a shift past midnight", () => {
    const nightShift = hours({ open: "22:00", close: "02:00" });
    expect(isWithinHours(nightShift, new Date("2026-11-17T23:00:00Z"))).toBe(true);
    expect(isWithinHours(nightShift, new Date("2026-11-18T01:00:00Z"))).toBe(true);
    expect(isWithinHours(nightShift, new Date("2026-11-18T12:00:00Z"))).toBe(false);
    expect(isWithinHours(nightShift, new Date("2026-11-17T21:59:00Z"))).toBe(false);
  });

  it("stays open all day when open and close match", () => {
    const allDay = hours({ open: "09:00", close: "09:00" });
    expect(isWithinHours(allDay, new Date("2026-11-17T03:00:00Z"))).toBe(true);
    expect(isWithinHours(allDay, SATURDAY_NOON)).toBe(false);
  });

  it("falls back to weekdays when no days were configured", () => {
    expect(isWithinHours(hours({ days: [] }), TUESDAY_NOON)).toBe(true);
    expect(isWithinHours(hours({ days: [] }), SATURDAY_NOON)).toBe(false);
  });

  it("judges the wall clock in the configured zone, not UTC", () => {
    // 00:00 UTC is already 09:00 in Tokyo, so the Tokyo office is just opening.
    const tokyo = hours({ timezone: "Asia/Tokyo" });
    expect(isWithinHours(tokyo, new Date("2026-11-17T00:00:00Z"))).toBe(true);
    // 23:00 UTC the previous day is 08:00 Tokyo — still before opening.
    expect(isWithinHours(tokyo, new Date("2026-11-16T23:00:00Z"))).toBe(false);
    // 18:00 UTC is 03:00 Tokyo the next day, outside the window.
    expect(isWithinHours(tokyo, new Date("2026-11-17T18:00:00Z"))).toBe(false);
  });

  it("never throws on an unknown zone — it judges in UTC instead", () => {
    const broken = hours({ timezone: "Not/AZone" });
    expect(() => isWithinHours(broken, TUESDAY_NOON)).not.toThrow();
    expect(isWithinHours(broken, TUESDAY_NOON)).toBe(true);
    expect(isWithinHours(broken, new Date("2026-11-17T18:00:00Z"))).toBe(false);
  });

  it("never throws on an unparsable clock", () => {
    const broken = hours({ open: "soon", close: "later" });
    expect(() => isWithinHours(broken, TUESDAY_NOON)).not.toThrow();
    expect(isWithinHours(broken, TUESDAY_NOON)).toBe(true);
  });
});

describe("buildWidgetConfig", () => {
  const withNumber: RawSettings = { whatsappNumber: "+233 20 123 4567" };

  it("hides the widget until a usable number is configured", () => {
    const empty = buildWidgetConfig({}, "UTC");
    expect(empty.enabled).toBe(false);
    expect(empty.number).toBe("");

    const invalid = buildWidgetConfig({ whatsappNumber: "call me" }, "UTC");
    expect(invalid.enabled).toBe(false);
    expect(invalid.number).toBe("");
  });

  it("turns on as soon as a number exists", () => {
    const config = buildWidgetConfig(withNumber, "UTC");
    expect(config.enabled).toBe(true);
    expect(config.number).toBe("233201234567");
  });

  it("honours an explicit opt-out without losing the number", () => {
    const config = buildWidgetConfig({ ...withNumber, enabled: false }, "UTC");
    expect(config.enabled).toBe(false);
    expect(config.number).toBe("233201234567");
  });

  it("supplies the documented defaults for everything else", () => {
    const config = buildWidgetConfig(withNumber, "UTC");
    expect(config.welcomeMessage).toBe("Hi! I'd like to know more about your services.");
    expect(config.presetMessages).toEqual([
      "I'd like a quote",
      "Are you available this week?",
      "Please send me your pricing",
    ]);
    expect(config.button).toEqual({ position: "bottom-right", color: "#25d366", size: "medium" });
    expect(config.hours.enabled).toBe(false);
    expect(config.analytics).toBe(true);
  });

  it("uses the site zone unless the operator pinned another one", () => {
    expect(buildWidgetConfig(withNumber, "Africa/Accra").hours.timezone).toBe("Africa/Accra");
    expect(
      buildWidgetConfig({ ...withNumber, businessTimezone: "Europe/Paris" }, "Africa/Accra").hours
        .timezone,
    ).toBe("Europe/Paris");
    expect(buildWidgetConfig({ ...withNumber, businessTimezone: "   " }, "").hours.timezone).toBe(
      "UTC",
    );
    expect(buildWidgetConfig(withNumber, "").hours.timezone).toBe("UTC");
  });

  it("evaluates open/closed at the moment the config is built", () => {
    const raw: RawSettings = { ...withNumber, businessHoursEnabled: true };
    const open = buildWidgetConfig(raw, "UTC", new Date("2026-11-17T12:00:00Z"));
    const closed = buildWidgetConfig(raw, "UTC", new Date("2026-11-17T18:00:00Z"));
    expect(open.hours.openNow).toBe(true);
    expect(closed.hours.openNow).toBe(false);
  });

  it("reads the analytics switch, defaulting to on", () => {
    expect(buildWidgetConfig(withNumber, "UTC").analytics).toBe(true);
    expect(buildWidgetConfig({ ...withNumber, analyticsEnabled: false }, "UTC").analytics).toBe(
      false,
    );
  });

  it("produces a body the plugin HTTP layer accepts without a cast", () => {
    const asBody = (value: Record<string, unknown>): Record<string, unknown> => value;
    const body = asBody(buildWidgetConfig(withNumber, "UTC"));
    expect(Object.keys(body)).toContain("number");
    expect(body).toMatchObject({ enabled: true, number: "233201234567" });
  });
});
