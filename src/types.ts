export type PageKind =
  | "blog_post"
  | "blog_archive"
  | "tag"
  | "author"
  | "landing"
  | "other";

export type OpportunityTag =
  | "high-impression-low-ctr"
  | "ranking-near-page-1"
  | "traffic-decline"
  | "weak-engagement"
  | "query-capture-gap";

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface SavedPluginConfig {
  siteOrigin: string;
  ga4PropertyId: string;
  gscSiteUrl: string;
  serviceAccountJson: string;
}

export interface PluginConfigSummary {
  siteOrigin: string;
  ga4PropertyId: string;
  gscSiteUrl: string;
  hasServiceAccount: boolean;
  serviceAccountEmail?: string;
}

export interface FreshnessState {
  lastSyncedAt: string | null;
  lastGscDate: string | null;
  lastGaDate: string | null;
  lastStatus: "idle" | "success" | "degraded" | "error";
}

export interface SiteSummary {
  window: {
    gscCurrent: { startDate: string; endDate: string };
    gscPrevious: { startDate: string; endDate: string };
    gaCurrent: { startDate: string; endDate: string };
    gaPrevious: { startDate: string; endDate: string };
  };
  totals: {
    gscClicks28d: number;
    gscImpressions28d: number;
    gaViews28d: number;
    gaUsers28d: number;
    gaSessions28d: number;
    managedOpportunities: number;
    trackedPages: number;
  };
  trend: Array<{
    date: string;
    gscClicks: number;
    gscImpressions: number;
    gaViews: number;
    gaSessions: number;
    gaUsers: number;
  }>;
}

export interface ManagedContentRef {
  collection: "posts";
  id: string;
  slug: string | null;
  urlPath: string;
  title: string;
  excerpt?: string;
  seoDescription?: string;
}

export interface PageAggregateRecord {
  urlPath: string;
  host: string;
  pageKind: PageKind;
  managed: boolean;
  title: string;
  contentCollection: string | null;
  contentId: string | null;
  contentSlug: string | null;
  gscClicks28d: number;
  gscImpressions28d: number;
  gscCtr28d: number;
  gscPosition28d: number;
  gscClicksPrev28d: number;
  gscImpressionsPrev28d: number;
  gaViews28d: number;
  gaUsers28d: number;
  gaSessions28d: number;
  gaEngagementRate28d: number;
  gaBounceRate28d: number;
  gaAvgSessionDuration28d: number;
  gaViewsPrev28d: number;
  gaUsersPrev28d: number;
  gaSessionsPrev28d: number;
  opportunityScore: number;
  opportunityTags: OpportunityTag[];
  lastSyncedAt: string;
  lastGscDate: string | null;
  lastGaDate: string | null;
}

export interface PageQueryRecord {
  urlPath: string;
  query: string;
  clicks28d: number;
  impressions28d: number;
  ctr28d: number;
  position28d: number;
  updatedAt: string;
}

export interface DailyMetricRecord {
  source: "gsc" | "ga";
  scope: "all_public";
  date: string;
  clicks: number;
  impressions: number;
  views: number;
  sessions: number;
  users: number;
}

export interface SyncRunRecord {
  jobType: "sync-base" | "enrich-managed-queries" | "manual" | "agent";
  status: "running" | "success" | "degraded" | "error";
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
}

export interface AgentKeyRecord {
  prefix: string;
  hash: string;
  label: string;
  /** Missing on keys created before scoped agent keys were introduced. */
  scopes?: AgentKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type AgentKeyScope = "analytics:read" | "analytics:sync" | "content-insights:write";

export interface AgentKeyMetadata extends Omit<AgentKeyRecord, "hash" | "scopes"> {
  scopes: AgentKeyScope[];
}

export type AgentSyncRunStatus = "queued" | "running" | "retrying" | "success" | "error";

export interface AgentSyncRun {
  id: string;
  status: AgentSyncRunStatus;
  actorKeyPrefix: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  nextRetryAt: string | null;
  attemptCount: number;
  summary: Record<string, unknown> | null;
  error: string | null;
}

export interface StoredAgentSyncRun extends Omit<AgentSyncRun, "id"> {
  idempotencyKeyHash: string;
  /** Non-null while queued, running, or retrying; a unique index enforces single-flight. */
  openLockKey: string | null;
  /** Private cursor used to continue bounded page writes across cron invocations. */
  pageWriteCursor?: string | null;
  /** Private monotonically increasing suffix for unique continuation task names. */
  pagePart?: number;
}

export interface AgentSyncRunResponse {
  accepted: boolean;
  idempotentReplay: boolean;
  retryAfterSeconds: number;
  run: AgentSyncRun;
}

export type ContentInsightActionStatus =
  | "planned"
  | "applied"
  | "measuring"
  | "improved"
  | "neutral"
  | "regressed"
  | "rolled_back"
  | "failed";

export interface ContentInsightDateRange {
  startDate: string;
  endDate: string;
}

export interface ContentInsightAction {
  id: string;
  contentCollection: string;
  contentId: string;
  contentSlug: string | null;
  contentKey: string;
  urlPath: string;
  targetQuery: string | null;
  reason: string;
  hypothesis: string;
  changeSummary: string;
  baselinePeriod: ContentInsightDateRange;
  measurementPeriod: ContentInsightDateRange;
  status: ContentInsightActionStatus;
  emdashRevisionId: string | null;
  detectedAt: string;
  revisionLinkedAt: string | null;
  appliedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredContentInsightAction extends ContentInsightAction {
  /** Set only while the action is open; a unique index enforces one open action per content. */
  openContentKey: string | null;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  lastMutationId: string;
  lastMutationFingerprint: string;
  lastMutationFromStatus: ContentInsightActionStatus | null;
}

export type ContentInsightActionEventType =
  | "created"
  | "revision_linked"
  | "measurement_recorded"
  | "status_changed";

export interface ContentInsightActionEvent {
  id: string;
  actionId: string;
  eventType: ContentInsightActionEventType;
  fromStatus: ContentInsightActionStatus | null;
  toStatus: ContentInsightActionStatus;
  actorKeyPrefix: string;
  metadata: Record<string, string | number | null>;
  createdAt: string;
}

export interface StoredContentInsightActionEvent extends ContentInsightActionEvent {
  idempotencyKeyHash: string;
  requestFingerprint: string;
}

export type ContentInsightMeasurementPhase = "baseline" | "post_change";

export interface ContentInsightMeasurement {
  id: string;
  actionId: string;
  phase: ContentInsightMeasurementPhase;
  source: "gsc";
  periodStart: string;
  periodEnd: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  recordedAt: string;
}

export interface StoredContentInsightMeasurement extends ContentInsightMeasurement {
  idempotencyKeyHash: string;
  requestFingerprint: string;
  actionStatusAtRecord: ContentInsightActionStatus;
}

export interface ContentInsightActionDetail {
  action: ContentInsightAction;
  events: ContentInsightActionEvent[];
  measurements: ContentInsightMeasurement[];
  idempotentReplay?: boolean;
}

export interface ContentInsightActionListResponse {
  items: ContentInsightAction[];
  cursor?: string;
  hasMore: boolean;
}

export interface ContentInsightActionCreateInput {
  contentCollection: string;
  contentId: string;
  contentSlug?: string | null;
  urlPath: string;
  targetQuery?: string | null;
  reason: string;
  hypothesis: string;
  changeSummary: string;
  baselinePeriod: ContentInsightDateRange;
  measurementPeriod: ContentInsightDateRange;
  detectedAt?: string;
}

export interface ContentInsightMeasurementInput {
  actionId: string;
  phase: ContentInsightMeasurementPhase;
  periodStart: string;
  periodEnd: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface OpportunityEvidence {
  tag: OpportunityTag;
  reason: string;
}

export interface ContentContextResponse {
  content: {
    collection: "posts";
    id: string;
    slug: string | null;
    title: string;
    urlPath: string;
    url: string;
    excerpt: string | null;
    seoDescription: string | null;
  };
  analytics: {
    window: SiteSummary["window"];
    page: PageAggregateRecord & {
      gscClicksDelta: number;
      gscImpressionsDelta: number;
      gaViewsDelta: number;
      gaUsersDelta: number;
      gaSessionsDelta: number;
    };
    searchQueries: PageQueryRecord[];
    opportunities: OpportunityEvidence[];
    freshness: FreshnessState;
  };
}

export interface KpiDelta {
  key: "gscClicks" | "gscImpressions" | "gaViews" | "gaUsers" | "gaSessions";
  label: string;
  current: number;
  previous: number;
  delta: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  trackedPages: number;
  current: {
    gscClicks: number;
    gaViews: number;
    gaSessions: number;
  };
  previous: {
    gscClicks: number;
    gaViews: number;
    gaSessions: number;
  };
  delta: {
    gscClicks: number;
    gaViews: number;
    gaSessions: number;
  };
}

export interface MoverRow {
  urlPath: string;
  title: string;
  pageKind: PageKind;
  managed: boolean;
  gscClicks28d: number;
  gaViews28d: number;
  gscClicksDelta: number;
  gaViewsDelta: number;
  opportunityScore: number;
}

export interface PageListFilters {
  managed?: "all" | "managed" | "unmanaged";
  hasOpportunity?: boolean;
  pageKind?: PageKind | "all";
  limit?: number;
  cursor?: string;
}

export interface PageListResponse {
  items: Array<PageAggregateRecord>;
  cursor?: string;
  hasMore: boolean;
}

export interface OverviewData {
  summary: SiteSummary | null;
  freshness: FreshnessState;
  kpiDeltas: KpiDelta[];
  pageKindBreakdown: BreakdownRow[];
  managedBreakdown: BreakdownRow[];
  topGainers: MoverRow[];
  topDecliners: MoverRow[];
  topOpportunities: PageAggregateRecord[];
  topUnmanaged: PageAggregateRecord[];
}
