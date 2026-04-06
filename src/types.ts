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
  jobType: "sync-base" | "enrich-managed-queries" | "manual";
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
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
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
