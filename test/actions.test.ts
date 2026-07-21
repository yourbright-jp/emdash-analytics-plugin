import type { StorageCollection } from "emdash";
import { describe, expect, it } from "vitest";

import {
  createContentInsightAction,
  linkContentInsightRevision,
  recordContentInsightMeasurement,
  requireIdempotencyKey,
  updateContentInsightActionStatus
} from "../src/actions.js";
import type { ContentInsightActionCreateInput } from "../src/types.js";

type QueryOptions = NonNullable<Parameters<StorageCollection["query"]>[0]>;
type WhereClause = NonNullable<QueryOptions["where"]>;

class MemoryCollection implements StorageCollection {
  readonly records = new Map<string, unknown>();
  failNextPut = false;

  async get(id: string): Promise<unknown | null> {
    return this.records.get(id) ?? null;
  }

  async put(id: string, data: unknown): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("simulated storage failure");
    }
    this.records.set(id, structuredClone(data));
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.records.has(id);
  }

  async getMany(ids: string[]): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    for (const id of ids) {
      const value = this.records.get(id);
      if (value !== undefined) result.set(id, structuredClone(value));
    }
    return result;
  }

  async putMany(items: Array<{ id: string; data: unknown }>): Promise<void> {
    for (const item of items) await this.put(item.id, item.data);
  }

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.records.delete(id)) deleted += 1;
    }
    return deleted;
  }

  async query(options: QueryOptions = {}) {
    const rows = Array.from(this.records, ([id, data]) => ({ id, data })).filter((row) =>
      matchesWhere(row.data, options.where)
    );
    const [order] = Object.entries(options.orderBy ?? {});
    if (order) {
      const [field, direction] = order;
      rows.sort((left, right) => {
        const leftValue = fieldValue(left.data, field);
        const rightValue = fieldValue(right.data, field);
        const compared = String(leftValue).localeCompare(String(rightValue));
        return direction === "desc" ? -compared : compared;
      });
    }
    const limit = options.limit ?? 50;
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        data: structuredClone(row.data)
      })),
      hasMore: rows.length > limit
    };
  }

  async count(where?: WhereClause): Promise<number> {
    return Array.from(this.records.values()).filter((value) => matchesWhere(value, where)).length;
  }
}

function createContext() {
  return {
    storage: {
      content_insight_actions: new MemoryCollection(),
      content_insight_action_events: new MemoryCollection(),
      content_insight_measurements: new MemoryCollection()
    }
  };
}

const ACTION_INPUT: ContentInsightActionCreateInput = {
  contentCollection: "posts",
  contentId: "post-1",
  contentSlug: "sample-post",
  urlPath: "/blog/sample-post/",
  targetQuery: "sample query",
  reason: "High impressions and low CTR",
  hypothesis: "A clearer title will improve CTR",
  changeSummary: "Rewrite the title and description",
  baselinePeriod: { startDate: "2026-06-01", endDate: "2026-06-28" },
  measurementPeriod: { startDate: "2026-07-01", endDate: "2026-07-28" },
  detectedAt: "2026-07-01T00:00:00.000Z"
};

describe("content insight action ledger", () => {
  it("requires a bounded idempotency key on write requests", () => {
    expect(() => requireIdempotencyKey(new Request("https://example.com"))).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED", status: 400 })
    );
    expect(
      requireIdempotencyKey(
        new Request("https://example.com", {
          headers: { "Idempotency-Key": "valid-key" }
        })
      )
    ).toBe("valid-key");
  });

  it("creates one action for idempotent retries and rejects a changed payload", async () => {
    const ctx = createContext();
    const created = await createContentInsightAction(
      ctx,
      ACTION_INPUT,
      "create-post-1",
      "yb_ins_test"
    );
    const replayed = await createContentInsightAction(
      ctx,
      ACTION_INPUT,
      "create-post-1",
      "yb_ins_test"
    );

    expect(created.action.status).toBe("planned");
    expect(replayed.idempotentReplay).toBe(true);
    expect(replayed.action.id).toBe(created.action.id);
    expect(ctx.storage.content_insight_actions.records.size).toBe(1);
    expect(ctx.storage.content_insight_action_events.records.size).toBe(1);

    await expect(
      createContentInsightAction(
        ctx,
        { ...ACTION_INPUT, changeSummary: "A different change" },
        "create-post-1",
        "yb_ins_test"
      )
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 });
  });

  it("prevents another open action for the same content", async () => {
    const ctx = createContext();
    await createContentInsightAction(ctx, ACTION_INPUT, "create-post-1", "yb_ins_test");

    await expect(
      createContentInsightAction(
        ctx,
        { ...ACTION_INPUT, targetQuery: "another query" },
        "create-post-1-again",
        "yb_ins_test"
      )
    ).rejects.toMatchObject({ code: "CONTENT_ACTION_IN_PROGRESS", status: 409 });
  });

  it("fails closed when the audit event cannot be stored", async () => {
    const ctx = createContext();
    ctx.storage.content_insight_action_events.failNextPut = true;

    await expect(
      createContentInsightAction(ctx, ACTION_INPUT, "create-post-failure", "yb_ins_test")
    ).rejects.toMatchObject({ code: "CONTENT_INSIGHT_STORAGE_FAILED", status: 500 });
    expect(ctx.storage.content_insight_actions.records.size).toBe(0);
    expect(ctx.storage.content_insight_action_events.records.size).toBe(0);
  });

  it("links a revision and records a complete measurement lifecycle", async () => {
    const ctx = createContext();
    const created = await createContentInsightAction(
      ctx,
      ACTION_INPUT,
      "create-post-lifecycle",
      "yb_ins_write"
    );
    const actionId = created.action.id;

    await expect(
      updateContentInsightActionStatus(
        ctx,
        actionId,
        "applied",
        "apply-before-revision",
        "yb_ins_write"
      )
    ).rejects.toMatchObject({ code: "REVISION_REQUIRED", status: 409 });

    await linkContentInsightRevision(
      ctx,
      actionId,
      "revision-42",
      "link-revision-42",
      "yb_ins_write"
    );
    const revisionEvent = Array.from(
      ctx.storage.content_insight_action_events.records.entries()
    ).find(([, value]) => fieldValue(value, "eventType") === "revision_linked");
    expect(revisionEvent).toBeDefined();
    if (revisionEvent) ctx.storage.content_insight_action_events.records.delete(revisionEvent[0]);
    const recoveredLink = await linkContentInsightRevision(
      ctx,
      actionId,
      "revision-42",
      "link-revision-42",
      "yb_ins_write"
    );
    expect(recoveredLink.idempotentReplay).toBe(true);
    await updateContentInsightActionStatus(
      ctx,
      actionId,
      "applied",
      "mark-applied",
      "yb_ins_write"
    );
    await recordContentInsightMeasurement(
      ctx,
      {
        actionId,
        phase: "baseline",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-28",
        clicks: 40,
        impressions: 1000,
        position: 6.2
      },
      "measure-baseline",
      "yb_ins_write"
    );
    await updateContentInsightActionStatus(
      ctx,
      actionId,
      "measuring",
      "mark-measuring",
      "yb_ins_write"
    );

    await expect(
      updateContentInsightActionStatus(
        ctx,
        actionId,
        "improved",
        "evaluate-too-early",
        "yb_ins_write"
      )
    ).rejects.toMatchObject({ code: "MEASUREMENTS_REQUIRED", status: 409 });

    await recordContentInsightMeasurement(
      ctx,
      {
        actionId,
        phase: "post_change",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-28",
        clicks: 70,
        impressions: 1000,
        position: 6.1
      },
      "measure-post-change",
      "yb_ins_write"
    );
    const completed = await updateContentInsightActionStatus(
      ctx,
      actionId,
      "improved",
      "evaluate-improved",
      "yb_ins_write"
    );

    expect(completed.action.status).toBe("improved");
    expect(completed.action.emdashRevisionId).toBe("revision-42");
    expect(completed.measurements).toHaveLength(2);
    expect(completed.measurements[0]?.ctr).toBe(0.04);
    expect(completed.measurements[1]?.ctr).toBe(0.07);
    expect(completed.events.map((event) => event.eventType)).toEqual([
      "created",
      "revision_linked",
      "status_changed",
      "measurement_recorded",
      "status_changed",
      "measurement_recorded",
      "status_changed"
    ]);
  });
});

function matchesWhere(value: unknown, where?: WhereClause): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, expected]) => fieldValue(value, field) === expected);
}

function fieldValue(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.getOwnPropertyDescriptor(value, field)?.value;
}
