import type { PluginContext } from "emdash";
import { PluginRouteError } from "emdash";

import type {
  ContentInsightAction,
  ContentInsightActionCreateInput,
  ContentInsightActionDetail,
  ContentInsightActionEvent,
  ContentInsightActionListResponse,
  ContentInsightActionStatus,
  ContentInsightMeasurement,
  ContentInsightMeasurementInput,
  StoredContentInsightAction,
  StoredContentInsightActionEvent,
  StoredContentInsightMeasurement
} from "./types.js";

type InsightsContext = Pick<PluginContext, "storage">;

const OPEN_ACTION_STATUSES: ContentInsightActionStatus[] = ["planned", "applied", "measuring"];
const FINAL_ACTION_STATUSES: ContentInsightActionStatus[] = [
  "improved",
  "neutral",
  "regressed",
  "rolled_back",
  "failed"
];

const ALLOWED_TRANSITIONS: Record<ContentInsightActionStatus, ContentInsightActionStatus[]> = {
  planned: ["applied", "failed"],
  applied: ["measuring", "rolled_back", "failed"],
  measuring: ["improved", "neutral", "regressed", "rolled_back", "failed"],
  improved: [],
  neutral: [],
  regressed: ["rolled_back"],
  rolled_back: [],
  failed: []
};

export interface ContentInsightActionListFilters {
  status?: ContentInsightActionStatus;
  contentId?: string;
  limit?: number;
  cursor?: string;
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (value.length < 8 || value.length > 200) {
    throw new PluginRouteError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key must be between 8 and 200 characters",
      400
    );
  }
  return value;
}

export async function createContentInsightAction(
  ctx: InsightsContext,
  input: ContentInsightActionCreateInput,
  idempotencyKey: string,
  actorKeyPrefix: string
): Promise<ContentInsightActionDetail> {
  const canonicalInput = {
    ...input,
    contentSlug: input.contentSlug ?? null,
    targetQuery: input.targetQuery ?? null,
    detectedAt: input.detectedAt ?? null
  };
  const [idempotencyKeyHash, requestFingerprint] = await Promise.all([
    sha256Hex(idempotencyKey),
    fingerprint(canonicalInput)
  ]);
  const actionId = `cia_${idempotencyKeyHash.slice(0, 26)}`;
  const eventId = await operationId("cie", "create", idempotencyKeyHash);
  const existing = await readAction(ctx, actionId);

  if (existing) {
    assertMatchingFingerprint(existing.requestFingerprint, requestFingerprint);
    const existingEvent = await readEvent(ctx, eventId);
    if (!existingEvent) {
      await ctx.storage.content_insight_action_events.put(
        eventId,
        buildEvent({
          id: eventId,
          action: existing,
          eventType: "created",
          actorKeyPrefix,
          idempotencyKeyHash,
          requestFingerprint,
          createdAt: existing.createdAt
        })
      );
    } else {
      assertMatchingFingerprint(existingEvent.requestFingerprint, requestFingerprint);
    }
    return { ...(await getContentInsightAction(ctx, actionId)), idempotentReplay: true };
  }

  const contentKey = `${input.contentCollection}:${input.contentId}`;
  await assertNoOpenAction(ctx, contentKey);

  const now = new Date().toISOString();
  const action: StoredContentInsightAction = {
    id: actionId,
    contentCollection: input.contentCollection,
    contentId: input.contentId,
    contentSlug: input.contentSlug ?? null,
    contentKey,
    urlPath: input.urlPath,
    targetQuery: input.targetQuery ?? null,
    reason: input.reason,
    hypothesis: input.hypothesis,
    changeSummary: input.changeSummary,
    baselinePeriod: input.baselinePeriod,
    measurementPeriod: input.measurementPeriod,
    status: "planned",
    emdashRevisionId: null,
    detectedAt: input.detectedAt ?? now,
    revisionLinkedAt: null,
    appliedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    openContentKey: contentKey,
    idempotencyKeyHash,
    requestFingerprint,
    lastMutationId: eventId,
    lastMutationFingerprint: requestFingerprint,
    lastMutationFromStatus: null
  };
  const event = buildEvent({
    id: eventId,
    action,
    eventType: "created",
    actorKeyPrefix,
    idempotencyKeyHash,
    requestFingerprint,
    createdAt: now
  });

  await persistActionAndEvent(ctx, action, event, null);
  return getContentInsightAction(ctx, actionId);
}

export async function listContentInsightActions(
  ctx: InsightsContext,
  filters: ContentInsightActionListFilters
): Promise<ContentInsightActionListResponse> {
  const where: Record<string, string> = {};
  if (filters.status) where.status = filters.status;
  if (filters.contentId) where.contentId = filters.contentId;

  const result = await ctx.storage.content_insight_actions.query({
    where,
    orderBy: { updatedAt: "desc" },
    limit: filters.limit ?? 50,
    cursor: filters.cursor
  });

  return {
    items: result.items.map((item) => toPublicAction(expectStoredAction(item.data))),
    cursor: result.cursor,
    hasMore: result.hasMore
  };
}

export async function getContentInsightAction(
  ctx: InsightsContext,
  actionId: string
): Promise<ContentInsightActionDetail> {
  const action = await requireAction(ctx, actionId);
  const [eventsResult, measurementsResult] = await Promise.all([
    ctx.storage.content_insight_action_events.query({
      where: { actionId },
      orderBy: { createdAt: "asc" },
      limit: 100
    }),
    ctx.storage.content_insight_measurements.query({
      where: { actionId },
      orderBy: { periodStart: "asc" },
      limit: 100
    })
  ]);

  return {
    action: toPublicAction(action),
    events: eventsResult.items.map((item) =>
      toPublicEvent(expectStoredEvent(item.data))
    ),
    measurements: measurementsResult.items.map((item) =>
      toPublicMeasurement(expectStoredMeasurement(item.data))
    )
  };
}

export async function linkContentInsightRevision(
  ctx: InsightsContext,
  actionId: string,
  revisionId: string,
  idempotencyKey: string,
  actorKeyPrefix: string
): Promise<ContentInsightActionDetail> {
  const [idempotencyKeyHash, requestFingerprint] = await Promise.all([
    sha256Hex(idempotencyKey),
    fingerprint({ actionId, revisionId })
  ]);
  const eventId = await operationId("cie", "link-revision", idempotencyKeyHash);
  if (await isEventReplay(ctx, eventId, requestFingerprint)) {
    return { ...(await getContentInsightAction(ctx, actionId)), idempotentReplay: true };
  }

  const current = await requireAction(ctx, actionId);
  if (current.lastMutationId === eventId) {
    assertMatchingFingerprint(current.lastMutationFingerprint, requestFingerprint);
    if (current.emdashRevisionId !== revisionId) {
      throw new PluginRouteError(
        "CORRUPT_PLUGIN_DATA",
        "Revision mutation state is inconsistent",
        500
      );
    }
    await ctx.storage.content_insight_action_events.put(
      eventId,
      buildEvent({
        id: eventId,
        action: current,
        eventType: "revision_linked",
        actorKeyPrefix,
        idempotencyKeyHash,
        requestFingerprint,
        createdAt: current.updatedAt,
        metadata: { revisionId }
      })
    );
    return { ...(await getContentInsightAction(ctx, actionId)), idempotentReplay: true };
  }
  if (current.emdashRevisionId) {
    throw new PluginRouteError(
      "REVISION_ALREADY_LINKED",
      "This action is already linked to an EmDash revision",
      409
    );
  }
  if (current.status !== "planned") {
    throw new PluginRouteError(
      "INVALID_ACTION_STATE",
      "An EmDash revision can only be linked while an action is planned",
      409
    );
  }

  const now = new Date().toISOString();
  const updated: StoredContentInsightAction = {
    ...current,
    emdashRevisionId: revisionId,
    revisionLinkedAt: now,
    updatedAt: now,
    lastMutationId: eventId,
    lastMutationFingerprint: requestFingerprint,
    lastMutationFromStatus: null
  };
  const event = buildEvent({
    id: eventId,
    action: updated,
    eventType: "revision_linked",
    actorKeyPrefix,
    idempotencyKeyHash,
    requestFingerprint,
    createdAt: now,
    metadata: { revisionId }
  });

  await persistActionAndEvent(ctx, updated, event, current);
  return getContentInsightAction(ctx, actionId);
}

export async function recordContentInsightMeasurement(
  ctx: InsightsContext,
  input: ContentInsightMeasurementInput,
  idempotencyKey: string,
  actorKeyPrefix: string
): Promise<ContentInsightActionDetail> {
  const [idempotencyKeyHash, requestFingerprint] = await Promise.all([
    sha256Hex(idempotencyKey),
    fingerprint(input)
  ]);
  const measurementId = await operationId("cim", "measurement", idempotencyKeyHash);
  const eventId = await operationId("cie", "measurement", idempotencyKeyHash);
  if (await isEventReplay(ctx, eventId, requestFingerprint)) {
    return {
      ...(await getContentInsightAction(ctx, input.actionId)),
      idempotentReplay: true
    };
  }

  const action = await requireAction(ctx, input.actionId);
  const existingMeasurementValue = await ctx.storage.content_insight_measurements.get(
    measurementId
  );
  if (existingMeasurementValue !== null) {
    const existingMeasurement = expectStoredMeasurement(existingMeasurementValue);
    assertMatchingFingerprint(existingMeasurement.requestFingerprint, requestFingerprint);
    const existingEvent = await readEvent(ctx, eventId);
    if (!existingEvent) {
      const eventAction: StoredContentInsightAction = {
        ...action,
        status: existingMeasurement.actionStatusAtRecord
      };
      await ctx.storage.content_insight_action_events.put(
        eventId,
        buildEvent({
          id: eventId,
          action: eventAction,
          eventType: "measurement_recorded",
          actorKeyPrefix,
          idempotencyKeyHash,
          requestFingerprint,
          createdAt: existingMeasurement.recordedAt,
          metadata: {
            measurementId,
            phase: existingMeasurement.phase,
            periodStart: existingMeasurement.periodStart,
            periodEnd: existingMeasurement.periodEnd
          }
        })
      );
    } else {
      assertMatchingFingerprint(existingEvent.requestFingerprint, requestFingerprint);
    }
    return {
      ...(await getContentInsightAction(ctx, input.actionId)),
      idempotentReplay: true
    };
  }
  if (FINAL_ACTION_STATUSES.includes(action.status)) {
    throw new PluginRouteError(
      "INVALID_ACTION_STATE",
      "Measurements cannot be added to a completed action",
      409
    );
  }
  if (input.phase === "post_change" && action.status === "planned") {
    throw new PluginRouteError(
      "INVALID_ACTION_STATE",
      "Post-change measurements require an applied or measuring action",
      409
    );
  }
  if (input.clicks > input.impressions) {
    throw new PluginRouteError(
      "BAD_REQUEST",
      "clicks cannot be greater than impressions",
      400
    );
  }
  const expectedPeriod =
    input.phase === "baseline" ? action.baselinePeriod : action.measurementPeriod;
  if (
    input.periodStart !== expectedPeriod.startDate ||
    input.periodEnd !== expectedPeriod.endDate
  ) {
    throw new PluginRouteError(
      "MEASUREMENT_PERIOD_MISMATCH",
      `The ${input.phase} measurement must match the action's declared period`,
      409,
      { expectedPeriod }
    );
  }

  const duplicate = await ctx.storage.content_insight_measurements.query({
    where: {
      actionId: input.actionId,
      phase: input.phase,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd
    },
    limit: 1
  });
  if (duplicate.items.length > 0) {
    throw new PluginRouteError(
      "MEASUREMENT_ALREADY_EXISTS",
      "A measurement already exists for this action, phase, and period",
      409
    );
  }

  const now = new Date().toISOString();
  const measurement: StoredContentInsightMeasurement = {
    id: measurementId,
    actionId: input.actionId,
    phase: input.phase,
    source: "gsc",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    clicks: input.clicks,
    impressions: input.impressions,
    ctr: input.impressions > 0 ? input.clicks / input.impressions : 0,
    position: input.position,
    recordedAt: now,
    idempotencyKeyHash,
    requestFingerprint,
    actionStatusAtRecord: action.status
  };
  const updatedAction: StoredContentInsightAction = {
    ...action,
    updatedAt: now,
    lastMutationId: eventId,
    lastMutationFingerprint: requestFingerprint,
    lastMutationFromStatus: action.status
  };
  const event = buildEvent({
    id: eventId,
    action: updatedAction,
    eventType: "measurement_recorded",
    actorKeyPrefix,
    idempotencyKeyHash,
    requestFingerprint,
    createdAt: now,
    metadata: {
      measurementId,
      phase: input.phase,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd
    }
  });

  try {
    await ctx.storage.content_insight_measurements.put(measurementId, measurement);
    await ctx.storage.content_insight_action_events.put(eventId, event);
    await ctx.storage.content_insight_actions.put(action.id, updatedAction);
  } catch (error) {
    await Promise.allSettled([
      ctx.storage.content_insight_measurements.delete(measurementId),
      ctx.storage.content_insight_action_events.delete(eventId),
      ctx.storage.content_insight_actions.put(action.id, action)
    ]);
    throw storageFailure("record measurement", error);
  }

  return getContentInsightAction(ctx, action.id);
}

export async function updateContentInsightActionStatus(
  ctx: InsightsContext,
  actionId: string,
  nextStatus: ContentInsightActionStatus,
  idempotencyKey: string,
  actorKeyPrefix: string
): Promise<ContentInsightActionDetail> {
  const [idempotencyKeyHash, requestFingerprint] = await Promise.all([
    sha256Hex(idempotencyKey),
    fingerprint({ actionId, status: nextStatus })
  ]);
  const eventId = await operationId("cie", "status", idempotencyKeyHash);
  if (await isEventReplay(ctx, eventId, requestFingerprint)) {
    return { ...(await getContentInsightAction(ctx, actionId)), idempotentReplay: true };
  }

  const current = await requireAction(ctx, actionId);
  if (current.lastMutationId === eventId) {
    assertMatchingFingerprint(current.lastMutationFingerprint, requestFingerprint);
    if (current.status !== nextStatus) {
      throw new PluginRouteError(
        "CORRUPT_PLUGIN_DATA",
        "Status mutation state is inconsistent",
        500
      );
    }
    await ctx.storage.content_insight_action_events.put(
      eventId,
      buildEvent({
        id: eventId,
        action: current,
        eventType: "status_changed",
        actorKeyPrefix,
        idempotencyKeyHash,
        requestFingerprint,
        createdAt: current.updatedAt,
        fromStatus: current.lastMutationFromStatus,
        metadata: {
          fromStatus: current.lastMutationFromStatus,
          toStatus: nextStatus
        }
      })
    );
    return { ...(await getContentInsightAction(ctx, actionId)), idempotentReplay: true };
  }
  if (!ALLOWED_TRANSITIONS[current.status].includes(nextStatus)) {
    throw new PluginRouteError(
      "INVALID_STATUS_TRANSITION",
      `Cannot transition an action from ${current.status} to ${nextStatus}`,
      409
    );
  }
  if (nextStatus === "applied" && !current.emdashRevisionId) {
    throw new PluginRouteError(
      "REVISION_REQUIRED",
      "Link an EmDash revision before marking the action as applied",
      409
    );
  }
  if (nextStatus === "applied" || nextStatus === "measuring") {
    await assertNoOpenAction(ctx, current.contentKey, current.id);
  }
  if (["improved", "neutral", "regressed"].includes(nextStatus)) {
    await assertEvaluationMeasurements(ctx, actionId);
  }

  const now = new Date().toISOString();
  const updated: StoredContentInsightAction = {
    ...current,
    status: nextStatus,
    appliedAt: nextStatus === "applied" ? now : current.appliedAt,
    completedAt: FINAL_ACTION_STATUSES.includes(nextStatus) ? now : current.completedAt,
    openContentKey: FINAL_ACTION_STATUSES.includes(nextStatus) ? null : current.contentKey,
    updatedAt: now,
    lastMutationId: eventId,
    lastMutationFingerprint: requestFingerprint,
    lastMutationFromStatus: current.status
  };
  const event = buildEvent({
    id: eventId,
    action: updated,
    eventType: "status_changed",
    actorKeyPrefix,
    idempotencyKeyHash,
    requestFingerprint,
    createdAt: now,
    fromStatus: current.status,
    metadata: { fromStatus: current.status, toStatus: nextStatus }
  });

  await persistActionAndEvent(ctx, updated, event, current);
  return getContentInsightAction(ctx, actionId);
}

async function assertNoOpenAction(
  ctx: InsightsContext,
  contentKey: string,
  excludedActionId?: string
): Promise<void> {
  const results = await Promise.all(
    OPEN_ACTION_STATUSES.map((status) =>
      ctx.storage.content_insight_actions.query({
        where: { contentKey, status },
        limit: 10
      })
    )
  );
  const conflict = results
    .flatMap((result) => result.items)
    .map((item) => expectStoredAction(item.data))
    .find((action) => action.id !== excludedActionId);

  if (conflict) {
    throw new PluginRouteError(
      "CONTENT_ACTION_IN_PROGRESS",
      `Content already has an open action: ${conflict.id}`,
      409,
      { actionId: conflict.id, status: conflict.status }
    );
  }
}

async function assertEvaluationMeasurements(
  ctx: InsightsContext,
  actionId: string
): Promise<void> {
  const [baseline, postChange] = await Promise.all([
    ctx.storage.content_insight_measurements.count({ actionId, phase: "baseline" }),
    ctx.storage.content_insight_measurements.count({ actionId, phase: "post_change" })
  ]);
  if (baseline < 1 || postChange < 1) {
    throw new PluginRouteError(
      "MEASUREMENTS_REQUIRED",
      "Baseline and post-change measurements are required before evaluation",
      409
    );
  }
}

async function persistActionAndEvent(
  ctx: InsightsContext,
  action: StoredContentInsightAction,
  event: StoredContentInsightActionEvent,
  previousAction: StoredContentInsightAction | null
): Promise<void> {
  try {
    await ctx.storage.content_insight_actions.put(action.id, action);
    await ctx.storage.content_insight_action_events.put(event.id, event);
  } catch (error) {
    if (previousAction) {
      await Promise.allSettled([
        ctx.storage.content_insight_actions.put(previousAction.id, previousAction),
        ctx.storage.content_insight_action_events.delete(event.id)
      ]);
    } else {
      await Promise.allSettled([
        ctx.storage.content_insight_actions.delete(action.id),
        ctx.storage.content_insight_action_events.delete(event.id)
      ]);
    }
    throw storageFailure("persist action event", error);
  }
}

async function isEventReplay(
  ctx: InsightsContext,
  eventId: string,
  requestFingerprint: string
): Promise<boolean> {
  const existing = await readEvent(ctx, eventId);
  if (!existing) return false;
  assertMatchingFingerprint(existing.requestFingerprint, requestFingerprint);
  return true;
}

function assertMatchingFingerprint(existing: string, incoming: string): void {
  if (existing !== incoming) {
    throw new PluginRouteError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "Idempotency-Key was already used with a different request",
      409
    );
  }
}

async function requireAction(
  ctx: InsightsContext,
  actionId: string
): Promise<StoredContentInsightAction> {
  const action = await readAction(ctx, actionId);
  if (!action) {
    throw new PluginRouteError("NOT_FOUND", "Content insight action not found", 404);
  }
  return action;
}

async function readAction(
  ctx: InsightsContext,
  actionId: string
): Promise<StoredContentInsightAction | null> {
  const value = await ctx.storage.content_insight_actions.get(actionId);
  return value === null ? null : expectStoredAction(value);
}

async function readEvent(
  ctx: InsightsContext,
  eventId: string
): Promise<StoredContentInsightActionEvent | null> {
  const value = await ctx.storage.content_insight_action_events.get(eventId);
  return value === null ? null : expectStoredEvent(value);
}

function expectStoredAction(value: unknown): StoredContentInsightAction {
  if (!isStoredAction(value)) {
    throw new PluginRouteError(
      "CORRUPT_PLUGIN_DATA",
      "Stored content insight action is invalid",
      500
    );
  }
  return value;
}

function expectStoredEvent(value: unknown): StoredContentInsightActionEvent {
  if (!isStoredEvent(value)) {
    throw new PluginRouteError(
      "CORRUPT_PLUGIN_DATA",
      "Stored content insight action event is invalid",
      500
    );
  }
  return value;
}

function expectStoredMeasurement(value: unknown): StoredContentInsightMeasurement {
  if (!isStoredMeasurement(value)) {
    throw new PluginRouteError(
      "CORRUPT_PLUGIN_DATA",
      "Stored content insight measurement is invalid",
      500
    );
  }
  return value;
}

function buildEvent(input: {
  id: string;
  action: StoredContentInsightAction;
  eventType: StoredContentInsightActionEvent["eventType"];
  actorKeyPrefix: string;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  createdAt: string;
  fromStatus?: ContentInsightActionStatus | null;
  metadata?: Record<string, string | number | null>;
}): StoredContentInsightActionEvent {
  return {
    id: input.id,
    actionId: input.action.id,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.action.status,
    actorKeyPrefix: input.actorKeyPrefix,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt,
    idempotencyKeyHash: input.idempotencyKeyHash,
    requestFingerprint: input.requestFingerprint
  };
}

function toPublicAction(record: StoredContentInsightAction): ContentInsightAction {
  return {
    id: record.id,
    contentCollection: record.contentCollection,
    contentId: record.contentId,
    contentSlug: record.contentSlug,
    contentKey: record.contentKey,
    urlPath: record.urlPath,
    targetQuery: record.targetQuery,
    reason: record.reason,
    hypothesis: record.hypothesis,
    changeSummary: record.changeSummary,
    baselinePeriod: record.baselinePeriod,
    measurementPeriod: record.measurementPeriod,
    status: record.status,
    emdashRevisionId: record.emdashRevisionId,
    detectedAt: record.detectedAt,
    revisionLinkedAt: record.revisionLinkedAt,
    appliedAt: record.appliedAt,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toPublicEvent(record: StoredContentInsightActionEvent): ContentInsightActionEvent {
  return {
    id: record.id,
    actionId: record.actionId,
    eventType: record.eventType,
    fromStatus: record.fromStatus,
    toStatus: record.toStatus,
    actorKeyPrefix: record.actorKeyPrefix,
    metadata: record.metadata,
    createdAt: record.createdAt
  };
}

function toPublicMeasurement(
  record: StoredContentInsightMeasurement
): ContentInsightMeasurement {
  return {
    id: record.id,
    actionId: record.actionId,
    phase: record.phase,
    source: record.source,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    clicks: record.clicks,
    impressions: record.impressions,
    ctr: record.ctr,
    position: record.position,
    recordedAt: record.recordedAt
  };
}

async function fingerprint(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

async function operationId(
  prefix: "cie" | "cim",
  operation: string,
  idempotencyKeyHash: string
): Promise<string> {
  const hash = await sha256Hex(`${operation}:${idempotencyKeyHash}`);
  return `${prefix}_${hash.slice(0, 26)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storageFailure(operation: string, error: unknown): PluginRouteError {
  console.error(
    JSON.stringify({
      message: "content insight storage operation failed",
      operation,
      error: error instanceof Error ? error.message : String(error)
    })
  );
  return new PluginRouteError(
    "CONTENT_INSIGHT_STORAGE_FAILED",
    "Content insight history could not be recorded",
    500
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredAction(value: unknown): value is StoredContentInsightAction {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.contentCollection === "string" &&
    typeof value.contentId === "string" &&
    isNullableString(value.contentSlug) &&
    typeof value.contentKey === "string" &&
    typeof value.urlPath === "string" &&
    isNullableString(value.targetQuery) &&
    typeof value.reason === "string" &&
    typeof value.hypothesis === "string" &&
    typeof value.changeSummary === "string" &&
    isDateRange(value.baselinePeriod) &&
    isDateRange(value.measurementPeriod) &&
    isActionStatus(value.status) &&
    isNullableString(value.emdashRevisionId) &&
    typeof value.detectedAt === "string" &&
    isNullableString(value.revisionLinkedAt) &&
    isNullableString(value.appliedAt) &&
    isNullableString(value.completedAt) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isNullableString(value.openContentKey) &&
    typeof value.idempotencyKeyHash === "string" &&
    typeof value.requestFingerprint === "string" &&
    typeof value.lastMutationId === "string" &&
    typeof value.lastMutationFingerprint === "string" &&
    (value.lastMutationFromStatus === null || isActionStatus(value.lastMutationFromStatus))
  );
}

function isStoredEvent(value: unknown): value is StoredContentInsightActionEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.actionId === "string" &&
    ["created", "revision_linked", "measurement_recorded", "status_changed"].includes(
      String(value.eventType)
    ) &&
    (value.fromStatus === null || isActionStatus(value.fromStatus)) &&
    isActionStatus(value.toStatus) &&
    typeof value.actorKeyPrefix === "string" &&
    isRecord(value.metadata) &&
    typeof value.createdAt === "string" &&
    typeof value.idempotencyKeyHash === "string" &&
    typeof value.requestFingerprint === "string"
  );
}

function isStoredMeasurement(value: unknown): value is StoredContentInsightMeasurement {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.actionId === "string" &&
    (value.phase === "baseline" || value.phase === "post_change") &&
    value.source === "gsc" &&
    typeof value.periodStart === "string" &&
    typeof value.periodEnd === "string" &&
    typeof value.clicks === "number" &&
    typeof value.impressions === "number" &&
    typeof value.ctr === "number" &&
    typeof value.position === "number" &&
    typeof value.recordedAt === "string" &&
    typeof value.idempotencyKeyHash === "string" &&
    typeof value.requestFingerprint === "string" &&
    isActionStatus(value.actionStatusAtRecord)
  );
}

function isDateRange(value: unknown): value is { startDate: string; endDate: string } {
  return (
    isRecord(value) &&
    typeof value.startDate === "string" &&
    typeof value.endDate === "string"
  );
}

function isActionStatus(value: unknown): value is ContentInsightActionStatus {
  return (
    typeof value === "string" &&
    [
      "planned",
      "applied",
      "measuring",
      "improved",
      "neutral",
      "regressed",
      "rolled_back",
      "failed"
    ].includes(value)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
