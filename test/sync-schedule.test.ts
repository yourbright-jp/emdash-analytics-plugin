import { describe, expect, it } from "vitest";

import {
  CONFIG_SYNC_INTERVAL_HOURS_KEY,
  CRON_SYNC_BASE,
  DEFAULT_SYNC_INTERVAL_HOURS,
  SYNC_INTERVAL_HOURS_OPTIONS
} from "../src/constants.js";
import {
  isSyncIntervalHours,
  loadSyncIntervalHours,
  saveSyncIntervalHours,
  syncIntervalToCron
} from "../src/sync-schedule.js";

function fakeCtx(initial?: unknown, withCron = true) {
  const kv = new Map<string, unknown>();
  if (initial !== undefined) kv.set(CONFIG_SYNC_INTERVAL_HOURS_KEY, initial);
  const scheduled: Array<{ name: string; schedule: string }> = [];
  const ctx = {
    kv: {
      get: async (key: string) => kv.get(key),
      set: async (key: string, value: unknown) => {
        kv.set(key, value);
      }
    },
    cron: withCron
      ? {
          schedule: async (name: string, opts: { schedule: string }) => {
            scheduled.push({ name, schedule: opts.schedule });
          }
        }
      : undefined
  };
  return { ctx: ctx as never, kv, scheduled };
}

describe("sync schedule", () => {
  it("keeps the previous every-6-hours schedule as the default", () => {
    expect(DEFAULT_SYNC_INTERVAL_HOURS).toBe(6);
    expect(syncIntervalToCron(DEFAULT_SYNC_INTERVAL_HOURS)).toBe("0 */6 * * *");
  });

  it("maps intervals to cron and uses a fixed hour for once a day", () => {
    expect(syncIntervalToCron(1)).toBe("0 */1 * * *");
    expect(syncIntervalToCron(12)).toBe("0 */12 * * *");
    expect(syncIntervalToCron(24)).toBe("0 8 * * *");
  });

  it("accepts only the supported intervals", () => {
    for (const hours of SYNC_INTERVAL_HOURS_OPTIONS) expect(isSyncIntervalHours(hours)).toBe(true);
    for (const bad of [0, 5, 7, 48, -1, 1.5, "6", null, undefined]) expect(isSyncIntervalHours(bad)).toBe(false);
  });

  it("falls back to the default when nothing valid is stored", async () => {
    expect(await loadSyncIntervalHours(fakeCtx().ctx)).toBe(6);
    expect(await loadSyncIntervalHours(fakeCtx(5).ctx)).toBe(6);
    expect(await loadSyncIntervalHours(fakeCtx(24).ctx)).toBe(24);
  });

  it("stores the interval and reschedules the base sync task", async () => {
    const { ctx, kv, scheduled } = fakeCtx();
    await saveSyncIntervalHours(ctx, 24);

    expect(kv.get(CONFIG_SYNC_INTERVAL_HOURS_KEY)).toBe(24);
    expect(scheduled).toEqual([{ name: CRON_SYNC_BASE, schedule: "0 8 * * *" }]);
  });

  it("rejects an unsupported interval without writing anything", async () => {
    const { ctx, kv, scheduled } = fakeCtx();
    await expect(saveSyncIntervalHours(ctx, 5)).rejects.toThrow(/must be one of/);

    expect(kv.size).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("still stores the interval when cron is unavailable", async () => {
    const { ctx, kv } = fakeCtx(undefined, false);
    await saveSyncIntervalHours(ctx, 12);
    expect(kv.get(CONFIG_SYNC_INTERVAL_HOURS_KEY)).toBe(12);
  });
});
