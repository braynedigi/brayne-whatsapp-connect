import { describe, expect, it } from "vitest";
import type { PluginContext, PluginDataApi, PluginDataRecord } from "@justflows/sdk";
import {
  ensureCounters,
  incrementCounter,
  incrementDayCounter,
  incrementDepartmentCounter,
  incrementHourCounter,
  incrementPageCounter,
  isAnalyticsEvent,
  readCounters,
} from "../../src/counters.js";
import { ANALYTICS_EVENTS } from "../../src/settings.js";

interface Row extends PluginDataRecord {
  collection: string;
}

/**
 * In-memory stand-in for `ctx.data`.
 *
 * `simulateConcurrentWrite` makes the first `cas` lose on purpose by letting
 * another visitor's increment land first — the situation the retry loop in
 * `incrementCounter` exists to survive.
 */
function createData(options: { simulateConcurrentWrite?: boolean } = {}) {
  const rows = new Map<string, Row>();
  let tick = 0;
  let simulate = options.simulateConcurrentWrite === true;
  const calls = { list: 0, get: 0, put: 0, cas: 0, transaction: 0, clear: 0 };

  const key = (collection: string, id: string) => `${collection} ${id}`;
  const stamp = () => {
    tick += 1;
    return `2026-11-17T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
  const copy = <T>(row: Row): PluginDataRecord<T> => ({
    id: row.id,
    data: row.data as T,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const api: PluginDataApi = {
    async list<T>(collection: string): Promise<PluginDataRecord<T>[]> {
      calls.list += 1;
      return [...rows.values()]
        .filter((row) => row.collection === collection)
        .map((row) => copy<T>(row));
    },
    async get<T>(collection: string, id: string): Promise<PluginDataRecord<T> | undefined> {
      calls.get += 1;
      const row = rows.get(key(collection, id));
      return row ? copy<T>(row) : undefined;
    },
    async put<T>(collection: string, id: string, data: T): Promise<void> {
      calls.put += 1;
      const now = stamp();
      const existing = rows.get(key(collection, id));
      rows.set(key(collection, id), {
        collection,
        id,
        data,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    },
    async delete(collection: string, id: string): Promise<void> {
      rows.delete(key(collection, id));
    },
    async cas<T>(
      collection: string,
      id: string,
      expectedUpdatedAt: string,
      data: T,
    ): Promise<boolean> {
      calls.cas += 1;
      const row = rows.get(key(collection, id));
      if (!row || row.updatedAt !== expectedUpdatedAt) return false;
      if (simulate) {
        simulate = false;
        const count =
          typeof row.data === "object" && row.data !== null && "count" in row.data
            ? Number((row.data as { count: unknown }).count)
            : 0;
        rows.set(key(collection, id), {
          ...row,
          data: { count: count + 1 },
          updatedAt: stamp(),
        });
        return false;
      }
      rows.set(key(collection, id), { ...row, data, updatedAt: stamp() });
      return true;
    },
    async transaction<T>(fn: (tx: PluginDataApi) => Promise<T>): Promise<T> {
      calls.transaction += 1;
      return fn(api);
    },
    async clear(): Promise<void> {
      calls.clear += 1;
      rows.clear();
    },
  };

  return { api, calls, rows };
}

function contextWith(data: PluginDataApi): PluginContext {
  return { pluginId: "justflows.brayne-whatsapp-connect", data } as unknown as PluginContext;
}

describe("isAnalyticsEvent", () => {
  it("accepts exactly the five events the widget can send", () => {
    expect([...ANALYTICS_EVENTS]).toEqual(["open", "close", "preset", "send", "lead"]);
    for (const event of ANALYTICS_EVENTS) expect(isAnalyticsEvent(event)).toBe(true);
  });

  it("rejects anything else, including look-alikes", () => {
    expect(isAnalyticsEvent("")).toBe(false);
    expect(isAnalyticsEvent("opens")).toBe(false);
    expect(isAnalyticsEvent("OPEN")).toBe(false);
    expect(isAnalyticsEvent("__proto__")).toBe(false);
    expect(isAnalyticsEvent("open; DROP TABLE")).toBe(false);
  });
});

describe("ensureCounters", () => {
  it("creates one zeroed row per event", async () => {
    const { api, rows } = createData();
    await ensureCounters(contextWith(api));

    expect([...rows.keys()].sort()).toEqual([
      "analytics close",
      "analytics lead",
      "analytics open",
      "analytics preset",
      "analytics send",
    ]);
    for (const row of rows.values()) expect(row.data).toEqual({ count: 0 });
  });

  it("is idempotent, so re-activation does not reset anything", async () => {
    const { api, calls } = createData();
    const ctx = contextWith(api);

    await ensureCounters(ctx);
    await incrementCounter(ctx, "open");
    const putsAfterFirstPass = calls.put;

    await ensureCounters(ctx);
    expect(calls.put).toBe(putsAfterFirstPass);
    expect(await readCounters(ctx)).toMatchObject({ open: 1 });
  });
});

describe("incrementCounter", () => {
  it("starts a counter from nothing", async () => {
    const { api } = createData();
    expect(await incrementCounter(contextWith(api), "send")).toBe(1);
  });

  it("adds one on each call", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    expect(await incrementCounter(ctx, "open")).toBe(1);
    expect(await incrementCounter(ctx, "open")).toBe(2);
    expect(await incrementCounter(ctx, "open")).toBe(3);
  });

  it("retries a lost compare-and-set instead of overwriting a concurrent write", async () => {
    const { api, calls } = createData({ simulateConcurrentWrite: true });
    const ctx = contextWith(api);
    await ensureCounters(ctx);

    // The first cas loses to another visitor; the retry must build on their
    // result rather than clobber it, so the total is 2 and not 1.
    expect(await incrementCounter(ctx, "open")).toBe(2);
    expect(calls.cas).toBe(2);
    expect(await readCounters(ctx)).toMatchObject({ open: 2 });
  });
});

describe("readCounters", () => {
  it("zero-fills events that have never been recorded", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    await incrementCounter(ctx, "preset");

    expect(await readCounters(ctx)).toEqual({
      open: 0,
      close: 0,
      preset: 1,
      send: 0,
      lead: 0,
    });
  });

  it("ignores rows this plugin does not own", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    await api.put("analytics", "not-an-event", { count: 999 });
    await api.put("some-other-collection", "open", { count: 12345 });

    expect(await readCounters(ctx)).toEqual({
      open: 0,
      close: 0,
      preset: 0,
      send: 0,
      lead: 0,
    });
  });

  it("treats a malformed row as zero rather than throwing", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await api.put("analytics", "open", { count: "lots" });
    await api.put("analytics", "close", "not an object");

    expect(await readCounters(ctx)).toEqual({
      open: 0,
      close: 0,
      preset: 0,
      send: 0,
      lead: 0,
    });
  });
});

describe("department counters", () => {
  it("records sends per department under send:<index>", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    expect(await incrementDepartmentCounter(ctx, 1)).toBe(1);
    expect(await incrementDepartmentCounter(ctx, 1)).toBe(2);
    expect(await incrementDepartmentCounter(ctx, 0)).toBe(1);

    expect(await readCounters(ctx)).toMatchObject({ "send:0": 1, "send:1": 2 });
  });

  it("refuses indexes outside the department range", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    for (const bad of [-1, 5, 1.5, Number.NaN]) {
      expect(await incrementDepartmentCounter(ctx, bad)).toBe(null);
    }
    expect(await readCounters(ctx)).toMatchObject({ send: 0 });
  });
});

describe("day, hour and page buckets", () => {
  it("records trend-chart day buckets", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    expect(await incrementDayCounter(ctx, "open", "2026-11-17")).toBe(1);
    expect(await incrementDayCounter(ctx, "open", "2026-11-17")).toBe(2);
    expect(await incrementDayCounter(ctx, "send", "2026-11-16")).toBe(1);

    expect(await readCounters(ctx)).toMatchObject({
      "open:2026-11-17": 2,
      "send:2026-11-16": 1,
    });
  });

  it("records busiest-hours buckets", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    expect(await incrementHourCounter(ctx, "open", 9)).toBe(1);
    expect(await incrementHourCounter(ctx, "send", 17)).toBe(1);

    expect(await readCounters(ctx)).toMatchObject({ "openhour:9": 1, "sendhour:17": 1 });
  });

  it("records page buckets for the path breakdown", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    expect(await incrementPageCounter(ctx, "/pricing", "2026-11-17")).toBe(1);

    expect(await readCounters(ctx)).toMatchObject({ "openpage:/pricing:2026-11-17": 1 });
  });

  it("refuses malformed bucket arguments", async () => {
    const { api } = createData();
    const ctx = contextWith(api);
    await ensureCounters(ctx);
    expect(await incrementDayCounter(ctx, "open", "17-11-2026")).toBe(null);
    expect(await incrementDayCounter(ctx, "open", "2026-11-17; DROP")).toBe(null);
    expect(await incrementHourCounter(ctx, "open", 24)).toBe(null);
    expect(await incrementHourCounter(ctx, "open", -1)).toBe(null);
    expect(await incrementPageCounter(ctx, "", "2026-11-17")).toBe(null);
    expect(await incrementPageCounter(ctx, "/ok", "not-a-date")).toBe(null);
    expect(await readCounters(ctx)).toEqual({ open: 0, close: 0, preset: 0, send: 0, lead: 0 });
  });
});
