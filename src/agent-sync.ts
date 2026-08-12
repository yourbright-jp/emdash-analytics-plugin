import type { PluginContext } from "emdash";
import { PluginRouteError } from "emdash";

import { CRON_AGENT_SYNC_PREFIX } from "./constants.js";
import { syncBase } from "./sync.js";
import type {
  AgentSyncRun,
  AgentSyncRunResponse,
  StoredAgentSyncRun
} from "./types.js";

type AgentSyncContext = PluginContext;

const OPEN_LOCK_KEY = "analytics-sync";
const COOLDOWN_MS = 15 * 60 * 1000;
const SCHEDULE_DELAY_MS = 1_000;
const MAX_ONESHOT_RETRIES = 5;

export async function requestAgentSync(
  ctx: AgentSyncContext,
  idempotencyKey: string,
  actorKeyPrefix: string
): Promise<AgentSyncRunResponse> {
  const idempotencyKeyHash = await sha256Hex(idempotencyKey);
  const runId = `asr_${idempotencyKeyHash.slice(0, 26)}`;
  const existing = await readStoredRun(ctx, runId);
  if (existing) {
    return response(runId, existing, true);
  }

  const active = await findActiveRun(ctx);
  if (active) {
    throw new PluginRouteError(
      "SYNC_IN_PROGRESS",
      "An analytics sync is already queued or running",
      409,
      { runId: active.id }
    );
  }

  await enforceCooldown(ctx);
  if (!ctx.cron) {
    throw new PluginRouteError("SYNC_UNAVAILABLE", "Cron scheduling is unavailable", 503);
  }

  const now = new Date().toISOString();
  const record: StoredAgentSyncRun = {
    status: "queued",
    actorKeyPrefix,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
    nextRetryAt: null,
    attemptCount: 0,
    summary: null,
    error: null,
    idempotencyKeyHash,
    openLockKey: OPEN_LOCK_KEY
  };

  try {
    await ctx.storage.agent_sync_runs.put(runId, record);
  } catch (error) {
    const concurrentlyActive = await findActiveRun(ctx);
    if (concurrentlyActive) {
      throw new PluginRouteError(
        "SYNC_IN_PROGRESS",
        "An analytics sync is already queued or running",
        409,
        { runId: concurrentlyActive.id }
      );
    }
    throw error;
  }

  try {
    await ctx.cron.schedule(`${CRON_AGENT_SYNC_PREFIX}${runId}`, {
      schedule: new Date(Date.now() + SCHEDULE_DELAY_MS).toISOString(),
      data: { runId }
    });
  } catch {
    const failedAt = new Date().toISOString();
    const failed: StoredAgentSyncRun = {
      ...record,
      status: "error",
      updatedAt: failedAt,
      finishedAt: failedAt,
      error: "SYNC_SCHEDULE_FAILED",
      openLockKey: null
    };
    await ctx.storage.agent_sync_runs.put(runId, failed);
    throw new PluginRouteError(
      "SYNC_SCHEDULE_FAILED",
      "The analytics sync could not be scheduled",
      503
    );
  }

  return response(runId, record, false);
}

export async function getAgentSyncRun(
  ctx: AgentSyncContext,
  runId: string
): Promise<AgentSyncRun> {
  if (!/^asr_[a-f0-9]{26}$/.test(runId)) {
    throw new PluginRouteError("BAD_REQUEST", "A valid sync run id is required", 400);
  }
  const record = await readStoredRun(ctx, runId);
  if (!record) {
    throw new PluginRouteError("NOT_FOUND", "Analytics sync run not found", 404);
  }
  return toPublicRun(runId, record);
}

export async function handleAgentSyncCron(
  ctx: AgentSyncContext,
  eventName: string,
  data?: Record<string, unknown>
): Promise<boolean> {
  if (!eventName.startsWith(CRON_AGENT_SYNC_PREFIX)) return false;

  const runId =
    typeof data?.runId === "string"
      ? data.runId
      : eventName.slice(CRON_AGENT_SYNC_PREFIX.length);
  const record = await readStoredRun(ctx, runId);
  if (!record || record.status === "success" || record.status === "error") return true;

  const retryCount = readRetryCount(data);
  const startedAt = new Date().toISOString();
  const running: StoredAgentSyncRun = {
    ...record,
    status: "running",
    startedAt: record.startedAt ?? startedAt,
    updatedAt: startedAt,
    nextRetryAt: null,
    attemptCount: retryCount + 1,
    error: null
  };
  await ctx.storage.agent_sync_runs.put(runId, running);

  try {
    const base = await syncBase(ctx, "agent", { persistDailyMetrics: false });
    const finishedAt = new Date().toISOString();
    await ctx.storage.agent_sync_runs.put(runId, {
      ...running,
      status: "success",
      updatedAt: finishedAt,
      finishedAt,
      summary: base,
      openLockKey: null
    } satisfies StoredAgentSyncRun);
    return true;
  } catch {
    const failedAt = new Date().toISOString();
    const exhausted = retryCount >= MAX_ONESHOT_RETRIES;
    const nextRetryAt = exhausted
      ? null
      : new Date(Date.now() + 60_000 * 2 ** retryCount).toISOString();
    await ctx.storage.agent_sync_runs.put(runId, {
      ...running,
      status: exhausted ? "error" : "retrying",
      updatedAt: failedAt,
      finishedAt: exhausted ? failedAt : null,
      nextRetryAt,
      error: exhausted ? "SYNC_FAILED" : "SYNC_RETRY_SCHEDULED",
      openLockKey: exhausted ? null : OPEN_LOCK_KEY
    } satisfies StoredAgentSyncRun);
    throw new Error("Agent analytics sync failed");
  }
}

async function enforceCooldown(ctx: AgentSyncContext): Promise<void> {
  const result = await ctx.storage.agent_sync_runs.query({
    where: { status: "success" },
    orderBy: { finishedAt: "desc" },
    limit: 1
  });
  const item = result.items[0];
  if (!item) return;
  const record = item.data as StoredAgentSyncRun;
  const finishedAtMs = record.finishedAt ? Date.parse(record.finishedAt) : Number.NaN;
  if (!Number.isFinite(finishedAtMs)) return;

  const retryAfterSeconds = Math.ceil((finishedAtMs + COOLDOWN_MS - Date.now()) / 1000);
  if (retryAfterSeconds > 0) {
    throw new PluginRouteError(
      "SYNC_COOLDOWN",
      "A successful analytics sync completed recently",
      429,
      { runId: item.id, retryAfterSeconds }
    );
  }
}

async function findActiveRun(
  ctx: AgentSyncContext
): Promise<{ id: string; record: StoredAgentSyncRun } | null> {
  const result = await ctx.storage.agent_sync_runs.query({
    where: { openLockKey: OPEN_LOCK_KEY },
    orderBy: { createdAt: "desc" },
    limit: 1
  });
  const item = result.items[0];
  return item ? { id: item.id, record: item.data as StoredAgentSyncRun } : null;
}

async function readStoredRun(
  ctx: AgentSyncContext,
  runId: string
): Promise<StoredAgentSyncRun | null> {
  return (await ctx.storage.agent_sync_runs.get(runId)) as StoredAgentSyncRun | null;
}

function response(
  runId: string,
  record: StoredAgentSyncRun,
  idempotentReplay: boolean
): AgentSyncRunResponse {
  return {
    accepted: record.status === "queued" || record.status === "running" || record.status === "retrying",
    idempotentReplay,
    retryAfterSeconds: record.status === "success" || record.status === "error" ? 0 : 5,
    run: toPublicRun(runId, record)
  };
}

function toPublicRun(runId: string, record: StoredAgentSyncRun): AgentSyncRun {
  return {
    id: runId,
    status: record.status,
    actorKeyPrefix: record.actorKeyPrefix,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
    nextRetryAt: record.nextRetryAt,
    attemptCount: record.attemptCount,
    summary: record.summary,
    error: record.error
  };
}

function readRetryCount(data?: Record<string, unknown>): number {
  const meta =
    data?.__emdash && typeof data.__emdash === "object"
      ? (data.__emdash as Record<string, unknown>)
      : null;
  const value = meta?.retryCount;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
