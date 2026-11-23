import type { PluginContext } from "@justflows/sdk";
import { ANALYTICS_EVENTS, MAX_DEPARTMENTS, type AnalyticsEvent } from "./settings.js";

/**
 * Aggregate interaction counters.
 *
 * Deliberately dumb storage: one row per event holding a single number. No IP
 * address, no phone number, no visitor id, no timestamp of the visit — nothing
 * that could describe a person. Rows live in `plugin_data` under this plugin's
 * own collection, so `deleteData` can wipe them in one call.
 */
const COLLECTION = "analytics";

interface Counter {
  count: number;
}

function countOf(value: unknown): number {
  if (value && typeof value === "object" && "count" in value) {
    const count = (value as { count: unknown }).count;
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) return count;
  }
  return 0;
}

/** Create every counter row that does not exist yet, so `cas` always has a row to update. */
export async function ensureCounters(ctx: PluginContext): Promise<void> {
  for (const event of ANALYTICS_EVENTS) {
    const existing = await ctx.data.get<Counter>(COLLECTION, event);
    if (!existing) await ctx.data.put<Counter>(COLLECTION, event, { count: 0 });
  }
}

/**
 * Add one to a counter row and return the new total, or `null` when a
 * concurrent writer kept winning. Uses compare-and-set rather than read/write
 * so two visitors clicking at the same moment cannot lose each other's count.
 */
async function incrementKey(ctx: PluginContext, key: string): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await ctx.data.get<Counter>(COLLECTION, key);
    if (!row) {
      await ctx.data.put<Counter>(COLLECTION, key, { count: 1 });
      return 1;
    }
    const next = countOf(row.data) + 1;
    const stored = await ctx.data.cas<Counter>(COLLECTION, key, row.updatedAt, { count: next });
    if (stored) return next;
  }
  return null;
}

export async function incrementCounter(
  ctx: PluginContext,
  event: AnalyticsEvent,
): Promise<number | null> {
  return incrementKey(ctx, event);
}

/**
 * Add one to the per-department send counter (`send:<index>`). The index is
 * the department's position in the settings list, 0-based, so nothing about
 * the visitor or the number itself is stored — just which chip was chosen.
 */
export async function incrementDepartmentCounter(
  ctx: PluginContext,
  departmentIndex: number,
): Promise<number | null> {
  if (
    !Number.isInteger(departmentIndex) ||
    departmentIndex < 0 ||
    departmentIndex >= MAX_DEPARTMENTS
  ) {
    return null;
  }
  return incrementKey(ctx, `send:${departmentIndex}`);
}

/** True when an unknown string is one of the events we record. */
export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Add one to a day bucket (`<event>:<YYYY-MM-DD>`), the row the admin trend
 * chart reads. The date is the site's local date, computed by the caller.
 */
export async function incrementDayCounter(
  ctx: PluginContext,
  event: AnalyticsEvent,
  date: string,
): Promise<number | null> {
  if (!DAY_RE.test(date)) return null;
  return incrementKey(ctx, `${event}:${date}`);
}

/**
 * Add one to an hour-of-day bucket (`openhour:<h>` or `sendhour:<h>`), the
 * rows the busiest-hours view reads. Hour is the site's local hour.
 */
export async function incrementHourCounter(
  ctx: PluginContext,
  kind: "open" | "send",
  hour: number,
): Promise<number | null> {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return incrementKey(ctx, `${kind}hour:${hour}`);
}

/**
 * Add one to a page bucket (`openpage:<path>:<YYYY-MM-DD>`), the rows the
 * page breakdown reads. The path is validated by the caller; only the path —
 * never a query string — is ever stored.
 */
export async function incrementPageCounter(
  ctx: PluginContext,
  page: string,
  date: string,
): Promise<number | null> {
  if (!DAY_RE.test(date) || page.length === 0 || page.length > 200) return null;
  return incrementKey(ctx, `openpage:${page}:${date}`);
}

/** Every counter row: totals, department sends, and the day/hour/page buckets. */
export async function readCounters(ctx: PluginContext): Promise<Record<string, number>> {
  const rows = await ctx.data.list<Counter>(COLLECTION);
  const counts: Record<string, number> = Object.fromEntries(
    ANALYTICS_EVENTS.map((event) => [event, 0]),
  );
  const DAY_BUCKET_RE = /^(open|preset|send|close|lead):\d{4}-\d{2}-\d{2}$/;
  const HOUR_BUCKET_RE = /^(open|send)hour:\d{1,2}$/;
  const PAGE_BUCKET_RE = /^openpage:.*:\d{4}-\d{2}-\d{2}$/;
  for (const row of rows) {
    const isEvent = (ANALYTICS_EVENTS as readonly string[]).includes(row.id);
    const isDepartment = /^send:\d+$/.test(row.id);
    const isBucket =
      DAY_BUCKET_RE.test(row.id) || HOUR_BUCKET_RE.test(row.id) || PAGE_BUCKET_RE.test(row.id);
    if (isEvent || isDepartment || isBucket) {
      counts[row.id] = countOf(row.data);
    }
  }
  return counts;
}
