import type { PluginContext } from "emdash";

import {
  CONFIG_SYNC_INTERVAL_HOURS_KEY,
  CRON_SYNC_BASE,
  DAILY_SYNC_HOUR_UTC,
  DEFAULT_SYNC_INTERVAL_HOURS,
  SYNC_INTERVAL_HOURS_OPTIONS
} from "./constants.js";

export function isSyncIntervalHours(value: unknown): value is (typeof SYNC_INTERVAL_HOURS_OPTIONS)[number] {
  return SYNC_INTERVAL_HOURS_OPTIONS.some((option) => option === value);
}

/** Cron expression for the base sync: `0 *\/X * * *`, or a fixed hour for 24. */
export function syncIntervalToCron(hours: number): string {
  if (hours >= 24) return `0 ${DAILY_SYNC_HOUR_UTC} * * *`;
  return `0 */${hours} * * *`;
}

export async function loadSyncIntervalHours(ctx: PluginContext): Promise<number> {
  const stored = await ctx.kv.get<number>(CONFIG_SYNC_INTERVAL_HOURS_KEY);
  return isSyncIntervalHours(stored) ? stored : DEFAULT_SYNC_INTERVAL_HOURS;
}

/** Persist the interval and move the base sync task to the matching schedule. */
export async function saveSyncIntervalHours(ctx: PluginContext, hours: number): Promise<void> {
  if (!isSyncIntervalHours(hours)) {
    throw new Error(`Sync interval must be one of ${SYNC_INTERVAL_HOURS_OPTIONS.join(", ")} hours`);
  }
  await ctx.kv.set(CONFIG_SYNC_INTERVAL_HOURS_KEY, hours);
  if (ctx.cron) {
    await ctx.cron.schedule(CRON_SYNC_BASE, { schedule: syncIntervalToCron(hours) });
  }
}
