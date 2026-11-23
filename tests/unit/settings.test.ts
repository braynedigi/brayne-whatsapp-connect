import { describe, expect, it } from "vitest";
import {
  buildWidgetConfig,
  clockLabel,
  holidayAt,
  isWithinHours,
  localDateInZone,
  localHourInZone,
  nextOpeningInstant,
  normalizeWhatsAppNumber,
  nudgeDelaySeconds,
  parseClock,
  parseDepartments,
  parseHolidays,
  parseLeadInterests,
  parseSchedule,
  resolveCatalogUrl,
  resolveColor,
  resolveDays,
  resolveOptionalColor,
  resolvePosition,
  resolveSize,
  scheduleSummary,
  splitPresetMessages,
  toBoolean,
  DEFAULT_LEAD_CONSENT,
  DEFAULT_NUDGE_TEXT,
  type BusinessHours,
  type HoursWindow,
  type RawSettings,
} from "../../src/settings.js";
import { STRINGS_EN } from "../../src/strings.js";

/** Tuesday 17 November 2026, midday UTC — a weekday, inside 09:00–17:00. */
const TUESDAY_NOON = new Date("2026-11-17T12:00:00Z");
/** Saturday 21 November 2026, midday UTC. */
const SATURDAY_NOON = new Date("2026-11-21T12:00:00Z");

/** "HH:MM" → minutes of day, for building test windows. */
function clockToMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map((part) => Number(part ?? 0));
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function windowOf(days: number[], open: string, close: string): HoursWindow {
  return { days, open: clockToMinutes(open), close: clockToMinutes(close) };
}

function hours(overrides: Partial<BusinessHours> = {}): BusinessHours {
  return {
    enabled: true,
    timezone: "UTC",
    windows: [windowOf([1, 2, 3, 4, 5], "09:00", "17:00")],
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
    expect(isWithinHours(hours({ enabled: false, windows: [] }), TUESDAY_NOON)).toBe(true);
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
    expect(isWithinHours(hours({ windows: [windowOf([0, 6], "09:00", "17:00")] }), SATURDAY_NOON)).toBe(
      true,
    );
    expect(isWithinHours(hours({ windows: [windowOf([0, 6], "09:00", "17:00")] }), TUESDAY_NOON)).toBe(
      false,
    );
  });

  it("reads a close at or before the open time as a shift past midnight", () => {
    const nightShift = hours({ windows: [windowOf([1, 2, 3, 4, 5], "22:00", "02:00")] });
    expect(isWithinHours(nightShift, new Date("2026-11-17T23:00:00Z"))).toBe(true);
    expect(isWithinHours(nightShift, new Date("2026-11-18T01:00:00Z"))).toBe(true);
    expect(isWithinHours(nightShift, new Date("2026-11-18T12:00:00Z"))).toBe(false);
    expect(isWithinHours(nightShift, new Date("2026-11-17T21:59:00Z"))).toBe(false);
  });

  it("stays open all day when open and close match", () => {
    const allDay = hours({ windows: [windowOf([1, 2, 3, 4, 5], "09:00", "09:00")] });
    expect(isWithinHours(allDay, new Date("2026-11-17T03:00:00Z"))).toBe(true);
    expect(isWithinHours(allDay, SATURDAY_NOON)).toBe(false);
  });

  it("stays open when the schedule is empty — a misconfiguration must not mute the button", () => {
    expect(isWithinHours(hours({ windows: [] }), SATURDAY_NOON)).toBe(true);
  });

  it("combines multiple windows on one day", () => {
    const split = hours({
      windows: [
        windowOf([1, 2, 3, 4, 5], "09:00", "12:00"),
        windowOf([1, 2, 3, 4, 5], "14:00", "17:00"),
      ],
    });
    expect(isWithinHours(split, new Date("2026-11-17T11:00:00Z"))).toBe(true);
    expect(isWithinHours(split, new Date("2026-11-17T13:00:00Z"))).toBe(false);
    expect(isWithinHours(split, new Date("2026-11-17T15:00:00Z"))).toBe(true);
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
});

describe("parseSchedule", () => {
  it("parses a valid schedule and drops malformed windows", () => {
    const parsed = parseSchedule(
      JSON.stringify([
        { days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00" },
        { days: [6], open: "10:00", close: "14:00" },
        { days: [0], open: "not-a-clock", close: "12:00" },
        { days: [1, 1, 2], open: "09:00", close: "17:00" },
        { days: [], open: "09:00", close: "17:00" },
        { days: [7], open: "09:00", close: "17:00" },
      ]),
      undefined,
      undefined,
      undefined,
    );
    expect(parsed).toEqual([
      { days: [1, 2, 3, 4, 5], open: 540, close: 1020 },
      { days: [6], open: 600, close: 840 },
    ]);
  });

  it("migrates the three legacy keys into one window", () => {
    const parsed = parseSchedule("", "mon-sat", "08:30", "18:00");
    expect(parsed).toEqual([{ days: [1, 2, 3, 4, 5, 6], open: 510, close: 1080 }]);
  });

  it("prefers a valid schedule over the legacy keys", () => {
    const stored = JSON.stringify([{ days: [0, 6], open: "11:00", close: "15:00" }]);
    const parsed = parseSchedule(stored, "weekdays", "09:00", "17:00");
    expect(parsed).toEqual([{ days: [0, 6], open: 660, close: 900 }]);
  });

  it("falls back to the legacy weekdays window when the stored value is not a JSON array", () => {
    const expected = [{ days: [1, 2, 3, 4, 5], open: 540, close: 1020 }];
    expect(parseSchedule("not json", undefined, undefined, undefined)).toEqual(expected);
    expect(parseSchedule('{"a":1}', undefined, undefined, undefined)).toEqual(expected);
    expect(parseSchedule(42, undefined, undefined, undefined)).toEqual(expected);
  });

  it("trusts a valid empty array — always open — over the legacy keys", () => {
    expect(parseSchedule("[]", "weekdays", "09:00", "17:00")).toEqual([]);
  });
});

describe("parseHolidays and holidayAt", () => {
  const holidays = () =>
    parseHolidays(
      JSON.stringify([
        { date: "2026-12-25", label: "Christmas Day" },
        { from: "2026-12-28", to: "2026-12-31", label: "Holiday break" },
        { date: "2026-02-30", label: "Not a real date" },
        { from: "2026-03-02", to: "2026-03-01", label: "Reversed range" },
      ]),
    );

  it("parses single days and ranges, dropping invalid dates", () => {
    const parsed = holidays();
    expect(parsed).toEqual([
      { from: "2026-12-25", to: "2026-12-25", label: "Christmas Day" },
      { from: "2026-12-28", to: "2026-12-31", label: "Holiday break" },
    ]);
  });

  it("matches the local date in the business zone", () => {
    const parsed = holidays();
    // 2026-12-25 01:00 UTC is still the 24th in Accra, and the 25th in UTC.
    expect(holidayAt(parsed, new Date("2026-12-25T01:00:00Z"), "UTC")).not.toBe(null);
    expect(holidayAt(parsed, new Date("2026-12-25T01:00:00Z"), "America/New_York")).toBe(null);
    expect(holidayAt(parsed, new Date("2026-12-29T12:00:00Z"), "UTC")?.label).toBe(
      "Holiday break",
    );
    expect(holidayAt(parsed, new Date("2026-12-27T12:00:00Z"), "UTC")).toBe(null);
  });

  it("returns null for a non-string setting", () => {
    expect(parseHolidays(undefined)).toEqual([]);
    expect(parseHolidays("not json")).toEqual([]);
  });
});

describe("nextOpeningInstant and scheduleSummary", () => {
  it("finds the next opening from a closed weekday evening", () => {
    const schedule = hours();
    // Tuesday 18:00 UTC — closed; next opening is Wednesday 09:00.
    const next = nextOpeningInstant(schedule, new Date("2026-11-17T18:00:00Z"));
    expect(next).not.toBe(null);
    expect(next?.toISOString()).toBe("2026-11-18T09:00:00.000Z");
  });

  it("skips the weekend to the next Monday", () => {
    const schedule = hours();
    const next = nextOpeningInstant(schedule, SATURDAY_NOON);
    expect(next?.toISOString()).toBe("2026-11-23T09:00:00.000Z");
  });

  it("returns null when hours are off or the schedule is empty", () => {
    expect(nextOpeningInstant(hours({ enabled: false }), TUESDAY_NOON)).toBe(null);
    expect(nextOpeningInstant(hours({ windows: [] }), TUESDAY_NOON)).toBe(null);
  });

  it("summarises multiple windows with day sets", () => {
    const summary = scheduleSummary(
      [
        windowOf([1, 2, 3, 4, 5], "09:00", "17:00"),
        windowOf([6], "10:00", "14:00"),
        windowOf([0], "11:00", "13:00"),
      ],
      STRINGS_EN,
    );
    expect(summary).toBe("Mon–Fri 09:00–17:00 · Sat 10:00–14:00 · Sun 11:00–13:00");
  });

  it("labels the clock and day names", () => {
    expect(clockLabel(0)).toBe("00:00");
    expect(clockLabel(540)).toBe("09:00");
    expect(clockLabel(1020)).toBe("17:00");
  });
});

describe("resolveOptionalColor", () => {
  it('keeps valid hex, lowercased, and "" for anything else', () => {
    expect(resolveOptionalColor("#12A150")).toBe("#12a150");
    expect(resolveOptionalColor(" #B45309 ")).toBe("#b45309");
    expect(resolveOptionalColor("")).toBe("");
    expect(resolveOptionalColor(undefined)).toBe("");
    expect(resolveOptionalColor("green")).toBe("");
    expect(resolveOptionalColor("url(javascript:x)")).toBe("");
  });
});

describe("parseDepartments", () => {
  it("parses valid entries and drops the rest", () => {
    const parsed = parseDepartments(
      JSON.stringify([
        { name: " Sales ", number: "+233 20 123 4567", icon: "💼" },
        { name: "Support", number: "15551234567" },
        { name: "", number: "15551234567" },
        { name: "NoNumber", number: "call me" },
      ]),
    );
    expect(parsed).toEqual([
      { name: "Sales", number: "233201234567", icon: "💼" },
      { name: "Support", number: "15551234567", icon: "" },
    ]);
  });

  it("caps the list and bounds each field", () => {
    const parsed = parseDepartments(
      JSON.stringify(
        Array.from({ length: 8 }, (_, index) => ({
          name: `D${index}`,
          number: "15551234567",
          icon: "x".repeat(20),
        })),
      ),
    );
    expect(parsed).toHaveLength(5);
    expect(parsed[0]?.icon).toHaveLength(8);
  });

  it("returns nothing for garbage input", () => {
    expect(parseDepartments("not json")).toEqual([]);
    expect(parseDepartments('{"a":1}')).toEqual([]);
    expect(parseDepartments(undefined)).toEqual([]);
  });
});

describe("resolveCatalogUrl", () => {
  it("accepts only wa.me catalog deep links", () => {
    expect(resolveCatalogUrl("https://wa.me/c/15551234567")).toBe(
      "https://wa.me/c/15551234567",
    );
    expect(resolveCatalogUrl(" https://wa.me/c/abc ")).toBe("https://wa.me/c/abc");
    expect(resolveCatalogUrl("")).toBe("");
    expect(resolveCatalogUrl("https://wa.me/15551234567")).toBe("");
    expect(resolveCatalogUrl("https://evil.example/c/")).toBe("");
    expect(resolveCatalogUrl('https://wa.me/c/" onmouseover="x')).toBe("");
    expect(resolveCatalogUrl(undefined)).toBe("");
  });
});

describe("parseLeadInterests", () => {
  it("splits, trims, bounds and caps the interest list", () => {
    expect(parseLeadInterests("A quote\n\n  Support  \nBookings")).toEqual([
      "A quote",
      "Support",
      "Bookings",
    ]);
    expect(parseLeadInterests("a\nb\nc\nd\ne\nf\ng\nh\ni")).toHaveLength(8);
    expect(parseLeadInterests("x".repeat(80))[0]).toHaveLength(60);
    expect(parseLeadInterests(undefined)).toEqual([]);
  });
});

describe("localDateInZone / localHourInZone", () => {
  it("reads the local date in the zone", () => {
    // 23:30 UTC on the 17th is already the 18th in Tokyo.
    expect(localDateInZone(new Date("2026-11-17T23:30:00Z"), "UTC")).toBe("2026-11-17");
    expect(localDateInZone(new Date("2026-11-17T23:30:00Z"), "Asia/Tokyo")).toBe("2026-11-18");
    // Accra sits behind UTC+0 all year; New York is behind by 5 hours in November.
    expect(localDateInZone(new Date("2026-11-17T02:00:00Z"), "America/New_York")).toBe(
      "2026-11-16",
    );
  });

  it("reads the local hour in the zone", () => {
    expect(localHourInZone(new Date("2026-11-17T12:30:00Z"), "UTC")).toBe(12);
    expect(localHourInZone(new Date("2026-11-17T12:30:00Z"), "Asia/Tokyo")).toBe(21);
    expect(localHourInZone(new Date("2026-11-17T00:15:00Z"), "America/New_York")).toBe(19);
  });

  it("falls back to UTC on an unknown zone instead of throwing", () => {
    expect(() => localDateInZone(new Date("2026-11-17T12:00:00Z"), "Not/AZone")).not.toThrow();
    expect(localHourInZone(new Date("2026-11-17T12:00:00Z"), "Not/AZone")).toBe(12);
  });
});

describe("nudgeDelaySeconds", () => {
  it("keeps a stored integer inside 5..300", () => {
    expect(nudgeDelaySeconds("15")).toBe(15);
    expect(nudgeDelaySeconds(" 5 ")).toBe(5);
    expect(nudgeDelaySeconds("300")).toBe(300);
  });

  it("clamps anything else to the 15-second default", () => {
    for (const bad of ["", "4", "301", "12.5", "soon", undefined]) {
      expect(nudgeDelaySeconds(bad)).toBe(15);
    }
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
    expect(config.greeting).toEqual({
      open: "Hi! I'd like to know more about your services.",
      closed: "Hi! I'd like to know more about your services.",
    });
    expect(config.presetMessages).toEqual([
      "I'd like a quote",
      "Are you available this week?",
      "Please send me your pricing",
    ]);
    expect(config.button).toEqual({ position: "bottom-right", color: "#25d366", size: "medium" });
    expect(config.hours.enabled).toBe(false);
    expect(config.analytics).toBe(true);
    expect(config.agent).toEqual({ name: "", role: "", photoUrl: "" });
    expect(config.utm).toBe(false);
    expect(config.pageRule).toBe(null);
    expect(config.departments).toEqual([]);
    expect(config.catalogUrl).toBe("");
    expect(config.lead).toEqual({
      enabled: false,
      interests: [],
      consentText: DEFAULT_LEAD_CONSENT,
    });
    expect(config.analyticsPages).toBe(false);
    expect(config.nudge).toEqual({
      enabled: false,
      delaySeconds: 15,
      text: DEFAULT_NUDGE_TEXT,
      mode: "once-per-load",
    });
  });

  it("resolves the nudge settings with the annoyance floor", () => {
    const config = buildWidgetConfig(
      {
        ...withNumber,
        nudgeEnabled: true,
        nudgeDelaySeconds: "4",
        nudgeText: "Chat with us!",
        nudgeMode: "once-per-day",
      },
      "UTC",
    );
    expect(config.nudge).toEqual({
      enabled: true,
      delaySeconds: 15,
      text: "Chat with us!",
      mode: "once-per-day",
    });
  });

  it("migrates the legacy single welcome message into both greetings", () => {
    const config = buildWidgetConfig(
      { ...withNumber, welcomeMessage: "Legacy hello!" },
      "UTC",
    );
    expect(config.greeting).toEqual({ open: "Legacy hello!", closed: "Legacy hello!" });
  });

  it("prefers the split greeting fields over the legacy message", () => {
    const config = buildWidgetConfig(
      {
        ...withNumber,
        welcomeMessage: "Legacy hello!",
        welcomeMessageOpen: "Open now!",
        welcomeMessageClosed: "Closed now!",
      },
      "UTC",
    );
    expect(config.greeting).toEqual({ open: "Open now!", closed: "Closed now!" });
  });

  it("applies the first matching page rule in document order", () => {
    const raw: RawSettings = {
      ...withNumber,
      pageRules: JSON.stringify([
        {
          pattern: "/pricing",
          welcome: "Want a quote?",
          presets: ["Send me your pricing"],
        },
        { pattern: "/pricing/*", welcome: "Second rule" },
        { pattern: "/blog", welcome: "Blog hello" },
      ]),
    };

    const pricing = buildWidgetConfig(raw, "UTC", new Date(), { page: "/pricing" });
    expect(pricing.pageRule).toEqual({ pattern: "/pricing" });
    expect(pricing.greeting.open).toBe("Want a quote?");
    expect(pricing.presetMessages).toEqual(["Send me your pricing"]);

    /** `/pricing` is an anchored glob, so a deeper path takes the next rule. */
    const deep = buildWidgetConfig(raw, "UTC", new Date(), { page: "/pricing/annual" });
    expect(deep.pageRule).toEqual({ pattern: "/pricing/*" });
    expect(deep.greeting.open).toBe("Second rule");

    const elsewhere = buildWidgetConfig(raw, "UTC", new Date(), { page: "/contact" });
    expect(elsewhere.pageRule).toBe(null);
    expect(elsewhere.greeting.open).toBe("Hi! I'd like to know more about your services.");
  });

  it("supports the * and ? wildcards in page rule patterns", () => {
    const raw: RawSettings = {
      ...withNumber,
      pageRules: JSON.stringify([
        { pattern: "/shop/*", welcome: "Shop" },
        { pattern: "/fa?", welcome: "FAQ" },
      ]),
    };
    expect(buildWidgetConfig(raw, "UTC", new Date(), { page: "/shop/123" }).pageRule).toEqual({
      pattern: "/shop/*",
    });
    expect(buildWidgetConfig(raw, "UTC", new Date(), { page: "/faq" }).pageRule).toEqual({
      pattern: "/fa?",
    });
    /** `?` stands for exactly one character, so `/fa` must not match `/fa?`. */
    expect(buildWidgetConfig(raw, "UTC", new Date(), { page: "/fa" }).pageRule).toBe(null);
  });

  it("drops malformed page rules instead of letting them reach the page", () => {
    const bad: RawSettings = {
      ...withNumber,
      pageRules: JSON.stringify([
        { pattern: "no-leading-slash", welcome: "Bad" },
        { pattern: "/ok(/", welcome: "Regex attempt" },
      ]),
    };
    const config = buildWidgetConfig(bad, "UTC", new Date(), { page: "/ok(" });
    expect(config.pageRule).toBe(null);
  });

  it("resolves the agent identity with a photo allow-list", () => {
    const config = buildWidgetConfig(
      {
        ...withNumber,
        agentName: "  Ama Mensah  ",
        agentRole: "Sales at Brayne",
        agentPhoto: " /media/team/ama.png ",
      },
      "UTC",
    );
    expect(config.agent).toEqual({
      name: "Ama Mensah",
      role: "Sales at Brayne",
      photoUrl: "/media/team/ama.png",
    });
  });

  it("refuses agent photo values that could break out of img.src", () => {
    for (const photo of ['javascript:alert(1)', "data:text/html,<script>", '" onerror="x', "http://x"] as const) {
      const config = buildWidgetConfig({ ...withNumber, agentPhoto: photo }, "UTC");
      expect(config.agent.photoUrl).toBe("");
    }
  });

  it("flips utm propagation only on a true toggle", () => {
    expect(buildWidgetConfig(withNumber, "UTC").utm).toBe(false);
    expect(buildWidgetConfig({ ...withNumber, utmPropagation: true }, "UTC").utm).toBe(true);
    expect(buildWidgetConfig({ ...withNumber, utmPropagation: "yes" }, "UTC").utm).toBe(false);
  });

  it("flips page counting only on a true toggle", () => {
    expect(buildWidgetConfig(withNumber, "UTC").analyticsPages).toBe(false);
    expect(buildWidgetConfig({ ...withNumber, analyticsPages: true }, "UTC").analyticsPages).toBe(
      true,
    );
    expect(buildWidgetConfig({ ...withNumber, analyticsPages: "yes" }, "UTC").analyticsPages).toBe(
      false,
    );
  });

  it("declares payload version 1 so old and new clients can coexist", () => {
    expect(buildWidgetConfig(withNumber, "UTC").version).toBe(1);
  });

  it("ships the resolved English string catalog", () => {
    const config = buildWidgetConfig(withNumber, "UTC");
    expect(config.strings).toEqual({ locale: "en", values: STRINGS_EN });
    expect(config.strings.values.dayNames).toHaveLength(7);
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
    expect(closed.hours.nextLabel).toBe("Wed 09:00");
  });

  it("migrates the legacy hour keys into a schedule window", () => {
    const raw: RawSettings = {
      ...withNumber,
      businessHoursEnabled: true,
      businessDays: "mon-sat",
      businessOpenTime: "08:30",
      businessCloseTime: "18:00",
    };
    const config = buildWidgetConfig(raw, "UTC", new Date("2026-11-21T12:00:00Z"));
    expect(config.hours.openNow).toBe(true);
    expect(config.hours.summary).toBe("Mon–Sat 08:30–18:00");
  });

  it("computes the closed badge from schedules, holidays and custom labels", () => {
    const raw: RawSettings = {
      ...withNumber,
      businessHoursEnabled: true,
      holidays: JSON.stringify([{ date: "2026-12-25", label: "Closed for Christmas" }]),
      openLabel: "We're open!",
      closedLabel: "We're away",
      closedExtra: "We reply when we reopen.",
      openColor: "#12A150",
      closedColor: "#B45309",
    };
    const holiday = buildWidgetConfig(raw, "UTC", new Date("2026-12-25T12:00:00Z"));
    expect(holiday.hours.openNow).toBe(false);
    expect(holiday.hours.onHoliday).toBe(true);
    expect(holiday.hours.holidayLabel).toBe("Closed for Christmas");
    expect(holiday.hours.openLabel).toBe("We're open!");
    expect(holiday.hours.closedLabel).toBe("We're away");
    expect(holiday.hours.closedExtra).toBe("We reply when we reopen.");
    expect(holiday.hours.openColor).toBe("#12a150");
    expect(holiday.hours.closedColor).toBe("#b45309");

    const open = buildWidgetConfig(raw, "UTC", new Date("2026-11-17T12:00:00Z"));
    expect(open.hours.openNow).toBe(true);
    expect(open.hours.openLabel).toBe("We're open!");

    const plainClosed = buildWidgetConfig(raw, "UTC", new Date("2026-11-17T18:00:00Z"));
    expect(plainClosed.hours.onHoliday).toBe(false);
    expect(plainClosed.hours.holidayLabel).toBe("");
    expect(plainClosed.hours.closedLabel).toBe("We're away");
  });

  it("summarises a multi-window schedule from the schedule setting", () => {
    const raw: RawSettings = {
      ...withNumber,
      businessHoursEnabled: true,
      schedule: JSON.stringify([
        { days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00" },
        { days: [6], open: "10:00", close: "14:00" },
      ]),
    };
    const config = buildWidgetConfig(raw, "UTC", SATURDAY_NOON);
    expect(config.hours.openNow).toBe(true);
    expect(config.hours.summary).toBe("Mon–Fri 09:00–17:00 · Sat 10:00–14:00");
  });

  it("resolves departments, catalog and the lead form from the settings", () => {
    const config = buildWidgetConfig(
      {
        ...withNumber,
        departments: JSON.stringify([
          { name: "Sales", number: "+233 20 123 4567", icon: "💼" },
          { name: "Support", number: "15551234567" },
        ]),
        catalogUrl: "https://wa.me/c/15551234567",
        leadFormEnabled: true,
        leadInterests: "A quote\nSupport",
        leadConsentText: "I agree to be contacted.",
      },
      "UTC",
    );
    expect(config.departments).toEqual([
      { name: "Sales", number: "233201234567", icon: "💼" },
      { name: "Support", number: "15551234567", icon: "" },
    ]);
    expect(config.catalogUrl).toBe("https://wa.me/c/15551234567");
    expect(config.lead).toEqual({
      enabled: true,
      interests: ["A quote", "Support"],
      consentText: "I agree to be contacted.",
    });
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
