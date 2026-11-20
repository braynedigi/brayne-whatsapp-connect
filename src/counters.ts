import type { PluginContext } from "@justflows/sdk";
import { ANALYTICS_EVENTS, type AnalyticsEvent } from "./settings.js";

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
 * Add one to an event's counter and return the new total, or `null` when a
 * concurrent writer kept winning. Uses compare-and-set rather than read/write
 * so two visitors clicking at the same moment cannot lose each other's count.
 */
export async function incrementCounter(
  ctx: PluginContext,
  event: AnalyticsEvent,
): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await ctx.data.get<Counter>(COLLECTION, event);
    if (!row) {
      await ctx.data.put<Counter>(COLLECTION, event, { count: 1 });
      return 1;
    }
    const next = countOf(row.data) + 1;
    const stored = await ctx.data.cas<Counter>(COLLECTION, event, row.updatedAt, { count: next });
    if (stored) return next;
  }
  return null;
}

/** Every counter, zero-filled for events that have not been recorded yet. */
export async function readCounters(ctx: PluginContext): Promise<Record<AnalyticsEvent, number>> {
  const rows = await ctx.data.list<Counter>(COLLECTION);
  const counts = Object.fromEntries(ANALYTICS_EVENTS.map((event) => [event, 0])) as Record<
    AnalyticsEvent,
    number
  >;
  for (const row of rows) {
    if ((ANALYTICS_EVENTS as readonly string[]).includes(row.id)) {
      counts[row.id as AnalyticsEvent] = countOf(row.data);
    }
  }
  return counts;
}

/** True when an unknown string is one of the events we record. */
export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value);
}
