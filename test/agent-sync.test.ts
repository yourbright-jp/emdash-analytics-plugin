import type { PluginContext } from "emdash";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAgentSyncRun,
  handleAgentSyncCron,
  requestAgentSync
} from "../src/agent-sync.js";
import { syncBase } from "../src/sync.js";
import type { StoredAgentSyncRun } from "../src/types.js";

vi.mock("../src/sync.js", () => ({
  syncBase: vi.fn()
}));

afterEach(() => {
  vi.resetAllMocks();
});

describe("agent analytics sync requests", () => {
  it("queues one-shot work and replays the same idempotency key", async () => {
    const fixture = createFixture();

    const first = await requestAgentSync(fixture.ctx, "sync-2026-08-12", "yb_ins_sync");
    const replay = await requestAgentSync(fixture.ctx, "sync-2026-08-12", "yb_ins_sync");

    expect(first).toMatchObject({
      accepted: true,
      idempotentReplay: false,
      run: { status: "queued", actorKeyPrefix: "yb_ins_sync" }
    });
    expect(first.run.id).toMatch(/^asr_[a-f0-9]{26}$/);
    expect(replay).toMatchObject({
      accepted: true,
      idempotentReplay: true,
      run: { id: first.run.id }
    });
    expect(fixture.schedule).toHaveBeenCalledTimes(1);
    expect(fixture.schedule).toHaveBeenCalledWith(
      `agent-sync-${first.run.id}`,
      expect.objectContaining({ data: { runId: first.run.id } })
    );
  });

  it("rejects a second sync while another run owns the open lock", async () => {
    const fixture = createFixture();
    await requestAgentSync(fixture.ctx, "sync-first-2026-08-12", "yb_ins_sync");

    await expect(
      requestAgentSync(fixture.ctx, "sync-second-2026-08-12", "yb_ins_other")
    ).rejects.toMatchObject({ code: "SYNC_IN_PROGRESS", status: 409 });
    expect(fixture.schedule).toHaveBeenCalledTimes(1);
  });

  it("returns public run state without idempotency hashes or lock fields", async () => {
    const fixture = createFixture();
    const queued = await requestAgentSync(fixture.ctx, "sync-status-2026-08-12", "yb_ins_sync");

    const run = await getAgentSyncRun(fixture.ctx, queued.run.id);

    expect(run).toEqual(queued.run);
    expect(run).not.toHaveProperty("idempotencyKeyHash");
    expect(run).not.toHaveProperty("openLockKey");
  });

  it("applies a cooldown after a successful sync", async () => {
    const fixture = createFixture();
    fixture.records.set("asr_aaaaaaaaaaaaaaaaaaaaaaaaaa", {
      status: "success",
      actorKeyPrefix: "yb_ins_sync",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      nextRetryAt: null,
      attemptCount: 1,
      summary: {},
      error: null,
      idempotencyKeyHash: "a".repeat(64),
      openLockKey: null
    });

    await expect(
      requestAgentSync(fixture.ctx, "sync-cooldown-2026-08-12", "yb_ins_sync")
    ).rejects.toMatchObject({ code: "SYNC_COOLDOWN", status: 429 });
    expect(fixture.schedule).not.toHaveBeenCalled();
  });
});

describe("agent analytics sync cron", () => {
  it("marks a run successful after the freshness-bearing base sync completes", async () => {
    const fixture = createFixture();
    const queued = await requestAgentSync(fixture.ctx, "sync-cron-success", "yb_ins_sync");
    vi.mocked(syncBase).mockResolvedValue({ trackedPages: 120, managedPages: 80 });

    await expect(
      handleAgentSyncCron(fixture.ctx, `agent-sync-${queued.run.id}`, { runId: queued.run.id })
    ).resolves.toBe(true);

    expect(syncBase).toHaveBeenCalledWith(fixture.ctx, "agent", {
      persistDailyMetrics: false,
      pageBatchSize: 50
    });

    expect(fixture.records.get(queued.run.id)).toMatchObject({
      status: "success",
      attemptCount: 1,
      openLockKey: null,
      error: null,
      summary: { trackedPages: 120, managedPages: 80 }
    });
  });

  it("keeps the lock while a failed run is eligible for retry", async () => {
    const fixture = createFixture();
    const queued = await requestAgentSync(fixture.ctx, "sync-cron-retry", "yb_ins_sync");
    vi.mocked(syncBase).mockRejectedValue(new Error("upstream failed"));

    await expect(
      handleAgentSyncCron(fixture.ctx, `agent-sync-${queued.run.id}`, { runId: queued.run.id })
    ).rejects.toThrow("Agent analytics sync failed");

    expect(fixture.records.get(queued.run.id)).toMatchObject({
      status: "retrying",
      attemptCount: 1,
      openLockKey: "analytics-sync",
      error: "SYNC_RETRY_SCHEDULED"
    });
  });

  it("releases the lock after the final failed retry", async () => {
    const fixture = createFixture();
    const queued = await requestAgentSync(fixture.ctx, "sync-cron-final-error", "yb_ins_sync");
    vi.mocked(syncBase).mockRejectedValue(new Error("upstream failed"));

    await expect(
      handleAgentSyncCron(fixture.ctx, `agent-sync-${queued.run.id}`, {
        runId: queued.run.id,
        __emdash: { retryCount: 5 }
      })
    ).rejects.toThrow("Agent analytics sync failed");

    expect(fixture.records.get(queued.run.id)).toMatchObject({
      status: "error",
      attemptCount: 6,
      openLockKey: null,
      error: "SYNC_FAILED"
    });
  });
});

function createFixture() {
  const records = new Map<string, StoredAgentSyncRun>();
  const schedule = vi.fn(async () => undefined);
  const collection = {
    async get(id: string) {
      return records.get(id) ?? null;
    },
    async put(id: string, record: StoredAgentSyncRun) {
      if (record.openLockKey) {
        const conflict = Array.from(records.entries()).find(
          ([otherId, other]) => otherId !== id && other.openLockKey === record.openLockKey
        );
        if (conflict) throw new Error("unique openLockKey violation");
      }
      records.set(id, structuredClone(record));
    },
    async query(options: {
      where?: Record<string, string>;
      orderBy?: Record<string, "asc" | "desc">;
      limit?: number;
    }) {
      let items = Array.from(records.entries()).map(([id, data]) => ({ id, data }));
      if (options.where) {
        items = items.filter(({ data }) =>
          Object.entries(options.where ?? {}).every(
            ([key, value]) => data[key as keyof StoredAgentSyncRun] === value
          )
        );
      }
      const [orderKey, direction] = Object.entries(options.orderBy ?? {})[0] ?? [];
      if (orderKey) {
        items.sort((a, b) => {
          const left = String(a.data[orderKey as keyof StoredAgentSyncRun] ?? "");
          const right = String(b.data[orderKey as keyof StoredAgentSyncRun] ?? "");
          return direction === "desc" ? right.localeCompare(left) : left.localeCompare(right);
        });
      }
      return { items: items.slice(0, options.limit), hasMore: false, cursor: undefined };
    }
  };
  const ctx = {
    storage: { agent_sync_runs: collection },
    cron: { schedule }
  } as unknown as PluginContext;
  return { ctx, records, schedule };
}
