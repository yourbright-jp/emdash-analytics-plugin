import { generatePrefixedToken, hashPrefixedToken } from "@emdash-cms/auth";
import type { PluginContext } from "emdash";
import { PluginRouteError } from "emdash";
import { ulid } from "ulidx";

import {
  AGENT_KEY_PREFIX,
  CRON_ENRICH_MANAGED,
  CRON_SYNC_BASE,
  FRESHNESS_KEY,
  GSC_QUERY_PAGE_LIMIT,
  GSC_QUERY_ROW_LIMIT,
  QUERY_REFRESH_STALE_HOURS,
  SITE_SUMMARY_KEY
} from "./constants.js";
import {
  buildContentUrl,
  classifyPageKind,
  dailyMetricStorageId,
  getManagedContentMap,
  resolveManagedContent,
  pageQueryStorageId,
  pageStorageId
} from "./content.js";
import { parseServiceAccount } from "./config-validation.js";
import { loadConfig } from "./config.js";
import {
  buildWindows,
  fetchGaDailyTrend,
  fetchGaPageMetrics,
  fetchGscDailyTrend,
  fetchGscPageMetrics,
  fetchGscPageQueries,
  runConnectionTest
} from "./google.js";
import { scorePage } from "./scoring.js";
import type {
  AgentKeyRecord,
  BreakdownRow,
  ContentContextResponse,
  DailyMetricRecord,
  FreshnessState,
  KpiDelta,
  ManagedContentRef,
  MoverRow,
  OverviewData,
  PageAggregateRecord,
  PageListFilters,
  PageListResponse,
  PageQueryRecord,
  PluginConfigSummary,
  SavedPluginConfig,
  SiteSummary,
  SyncRunRecord
} from "./types.js";

type PluginCtx = PluginContext;
type CombinedTrendMetric = {
  date: string;
  clicks: number;
  impressions: number;
  views: number;
  sessions: number;
  users: number;
};

export async function getStatus(ctx: PluginCtx): Promise<{
  config: PluginConfigSummary | null;
  summary: SiteSummary | null;
  freshness: FreshnessState;
}> {
  const config = await loadConfig(ctx);
  return {
    config: config
      ? {
          siteOrigin: config.siteOrigin,
          ga4PropertyId: config.ga4PropertyId,
          gscSiteUrl: config.gscSiteUrl,
          hasServiceAccount: true,
          serviceAccountEmail: parseServiceAccount(config.serviceAccountJson).client_email
        }
      : null,
    summary: await ctx.kv.get<SiteSummary>(SITE_SUMMARY_KEY),
    freshness: await getFreshness(ctx)
  };
}

export async function testConnection(
  ctx: PluginCtx,
  draftConfig?: SavedPluginConfig | null
): Promise<Record<string, unknown>> {
  const config = draftConfig ?? (await loadConfig(ctx));
  if (!config) {
    throw new PluginRouteError("BAD_REQUEST", "Analytics connection is not configured", 400);
  }
  if (!ctx.http) {
    throw new PluginRouteError("INTERNAL_ERROR", "HTTP capability is unavailable", 500);
  }
  return runConnectionTest(ctx.http, config, parseServiceAccount(config.serviceAccountJson));
}

export async function syncBase(ctx: PluginCtx, jobType: SyncRunRecord["jobType"]): Promise<{
  trackedPages: number;
  managedPages: number;
}> {
  const config = await requireConfig(ctx);
  if (!ctx.http) {
    throw new PluginRouteError("INTERNAL_ERROR", "HTTP capability is unavailable", 500);
  }

  const serviceAccount = parseServiceAccount(config.serviceAccountJson);
  const windows = buildWindows();
  const startedAt = new Date().toISOString();
  const managedMap = await getManagedContentMap(config.siteOrigin);

  const [gscCurrent, gscPrevious, gscTrend, gaCurrent, gaPrevious, gaTrend] = await Promise.all([
    fetchGscPageMetrics(ctx.http, config, serviceAccount, windows.gscCurrent),
    fetchGscPageMetrics(ctx.http, config, serviceAccount, windows.gscPrevious),
    fetchGscDailyTrend(ctx.http, config, serviceAccount, windows.gscCurrent),
    fetchGaPageMetrics(ctx.http, config, serviceAccount, windows.gaCurrent),
    fetchGaPageMetrics(ctx.http, config, serviceAccount, windows.gaPrevious),
    fetchGaDailyTrend(ctx.http, config, serviceAccount, windows.gaCurrent)
  ]);

  const host = new URL(config.siteOrigin).hostname;
  const pages = new Map<string, PageAggregateRecord>();
  const nowIso = new Date().toISOString();

  const ensurePage = (urlPath: string): PageAggregateRecord => {
    const existing = pages.get(urlPath);
    if (existing) return existing;

    const managed = managedMap.get(urlPath) ?? null;
    const created: PageAggregateRecord = {
      urlPath,
      host,
      pageKind: classifyPageKind(urlPath),
      managed: !!managed,
      title: managed?.title || urlPath,
      contentCollection: managed?.collection || null,
      contentId: managed?.id || null,
      contentSlug: managed?.slug || null,
      gscClicks28d: 0,
      gscImpressions28d: 0,
      gscCtr28d: 0,
      gscPosition28d: 0,
      gscClicksPrev28d: 0,
      gscImpressionsPrev28d: 0,
      gaViews28d: 0,
      gaUsers28d: 0,
      gaSessions28d: 0,
      gaEngagementRate28d: 0,
      gaBounceRate28d: 0,
      gaAvgSessionDuration28d: 0,
      gaViewsPrev28d: 0,
      gaUsersPrev28d: 0,
      gaSessionsPrev28d: 0,
      opportunityScore: 0,
      opportunityTags: [],
      lastSyncedAt: nowIso,
      lastGscDate: windows.gscCurrent.endDate,
      lastGaDate: windows.gaCurrent.endDate
    };
    pages.set(urlPath, created);
    return created;
  };

  for (const metric of gscCurrent) {
    const page = ensurePage(metric.urlPath);
    page.gscClicks28d = metric.clicks;
    page.gscImpressions28d = metric.impressions;
    page.gscCtr28d = metric.ctr;
    page.gscPosition28d = metric.position;
  }
  for (const metric of gscPrevious) {
    const page = ensurePage(metric.urlPath);
    page.gscClicksPrev28d = metric.clicks;
    page.gscImpressionsPrev28d = metric.impressions;
  }
  for (const metric of gaCurrent) {
    const page = ensurePage(metric.urlPath);
    page.gaViews28d = metric.views;
    page.gaUsers28d = metric.users;
    page.gaSessions28d = metric.sessions;
    page.gaEngagementRate28d = metric.engagementRate;
    page.gaBounceRate28d = metric.bounceRate;
    page.gaAvgSessionDuration28d = metric.averageSessionDuration;
  }
  for (const metric of gaPrevious) {
    const page = ensurePage(metric.urlPath);
    page.gaViewsPrev28d = metric.views;
    page.gaUsersPrev28d = metric.users;
    page.gaSessionsPrev28d = metric.sessions;
  }

  for (const page of pages.values()) {
    const score = scorePage(page, []);
    page.opportunityScore = score.score;
    page.opportunityTags = score.tags;
  }

  await ctx.storage.pages.putMany(
    Array.from(pages.values()).map((page) => ({
      id: pageStorageId(page.urlPath),
      data: page
    }))
  );

  const combinedTrend = mergeTrend(gscTrend, gaTrend);
  await ctx.storage.daily_metrics.putMany(
    combinedTrend.flatMap((row) => [
      {
        id: dailyMetricStorageId("gsc", "all_public", row.date),
        data: {
          source: "gsc",
          scope: "all_public",
          date: row.date,
          clicks: row.clicks,
          impressions: row.impressions,
          views: 0,
          sessions: 0,
          users: 0
        } satisfies DailyMetricRecord
      },
      {
        id: dailyMetricStorageId("ga", "all_public", row.date),
        data: {
          source: "ga",
          scope: "all_public",
          date: row.date,
          clicks: 0,
          impressions: 0,
          views: row.views,
          sessions: row.sessions,
          users: row.users
        } satisfies DailyMetricRecord
      }
    ])
  );

  const freshness: FreshnessState = {
    lastSyncedAt: nowIso,
    lastGscDate: windows.gscCurrent.endDate,
    lastGaDate: windows.gaCurrent.endDate,
    lastStatus: "success"
  };
  const summary = buildSummary(Array.from(pages.values()), combinedTrend, windows);
  await Promise.all([
    ctx.kv.set(FRESHNESS_KEY, freshness),
    ctx.kv.set(SITE_SUMMARY_KEY, summary),
    writeSyncRun(ctx, {
      jobType,
      status: "success",
      startedAt,
      finishedAt: nowIso,
      summary: {
        trackedPages: pages.size,
        managedPages: Array.from(pages.values()).filter((page) => page.managed).length
      },
      error: null
    })
  ]);

  return {
    trackedPages: pages.size,
    managedPages: Array.from(pages.values()).filter((page) => page.managed).length
  };
}

export async function enrichManagedQueries(ctx: PluginCtx): Promise<{ refreshedPages: number }> {
  const config = await requireConfig(ctx);
  if (!ctx.http) {
    throw new PluginRouteError("INTERNAL_ERROR", "HTTP capability is unavailable", 500);
  }
  const serviceAccount = parseServiceAccount(config.serviceAccountJson);
  const windows = buildWindows();

  const candidateResult = await ctx.storage.pages.query({
    where: {
      managed: true,
      opportunityScore: { gt: 0 }
    },
    orderBy: { opportunityScore: "desc" },
    limit: GSC_QUERY_PAGE_LIMIT
  });

  let refreshedPages = 0;
  for (const item of candidateResult.items) {
    const page = item.data as PageAggregateRecord;
    const queries = await fetchGscPageQueries(
      ctx.http,
      config,
      serviceAccount,
      page.urlPath,
      windows.gscCurrent,
      GSC_QUERY_ROW_LIMIT
    );
    const existing = await ctx.storage.page_queries.query({
      where: { urlPath: page.urlPath },
      limit: 100
    });
    if (existing.items.length > 0) {
      await ctx.storage.page_queries.deleteMany(existing.items.map((entry) => entry.id));
    }
    if (queries.length > 0) {
      await ctx.storage.page_queries.putMany(
        queries.map((query) => ({
          id: pageQueryStorageId(page.urlPath, query.query),
          data: {
            urlPath: page.urlPath,
            query: query.query,
            clicks28d: query.clicks,
            impressions28d: query.impressions,
            ctr28d: query.ctr,
            position28d: query.position,
            updatedAt: new Date().toISOString()
          } satisfies PageQueryRecord
        }))
      );
    }

    const queryRows = await getPageQueries(ctx, page.urlPath);
    const rescored = scorePage(page, queryRows);
    page.opportunityScore = rescored.score;
    page.opportunityTags = rescored.tags;
    page.lastSyncedAt = new Date().toISOString();
    await ctx.storage.pages.put(pageStorageId(page.urlPath), page);
    refreshedPages += 1;
  }

  await refreshSummaryFromStorage(ctx);
  await writeSyncRun(ctx, {
    jobType: CRON_ENRICH_MANAGED,
    status: "success",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    summary: { refreshedPages },
    error: null
  });

  return { refreshedPages };
}

export async function listPages(ctx: PluginCtx, filters: PageListFilters): Promise<PageListResponse> {
  const where: Record<string, any> = {};
  if (filters.managed === "managed") where.managed = true;
  if (filters.managed === "unmanaged") where.managed = false;
  if (filters.pageKind && filters.pageKind !== "all") where.pageKind = filters.pageKind;
  if (filters.hasOpportunity) where.opportunityScore = { gt: 0 };

  const result = await ctx.storage.pages.query({
    where,
    orderBy: { opportunityScore: "desc" },
    limit: filters.limit ?? 50,
    cursor: filters.cursor
  });

  return {
    items: result.items.map((item) => item.data as PageAggregateRecord),
    cursor: result.cursor,
    hasMore: result.hasMore
  };
}

export async function getOverview(ctx: PluginCtx): Promise<OverviewData> {
  const [summary, freshness, topOpportunities, topUnmanaged, allPages] = await Promise.all([
    ctx.kv.get<SiteSummary>(SITE_SUMMARY_KEY),
    getFreshness(ctx),
    ctx.storage.pages.query({
      where: { managed: true, opportunityScore: { gt: 0 } },
      orderBy: { opportunityScore: "desc" },
      limit: 5
    }),
    ctx.storage.pages.query({
      where: { managed: false },
      orderBy: { gaViews28d: "desc" },
      limit: 5
    }),
    listAllPages(ctx)
  ]);

  return buildOverviewData(
    summary,
    freshness,
    allPages,
    topOpportunities.items.map((item) => item.data as PageAggregateRecord),
    topUnmanaged.items.map((item) => item.data as PageAggregateRecord)
  );
}

export function buildOverviewData(
  summary: SiteSummary | null,
  freshness: FreshnessState,
  allPages: PageAggregateRecord[],
  topOpportunities: PageAggregateRecord[],
  topUnmanaged: PageAggregateRecord[]
): OverviewData {
  return {
    summary,
    freshness,
    kpiDeltas: buildKpiDeltas(allPages),
    pageKindBreakdown: buildBreakdown(
      allPages,
      (page) => page.pageKind,
      (key) => pageKindLabel(key as PageAggregateRecord["pageKind"])
    ),
    managedBreakdown: buildBreakdown(
      allPages,
      (page) => (page.managed ? "managed" : "unmanaged"),
      (key) => (key === "managed" ? "Managed" : "Unmanaged")
    ),
    topGainers: buildMovers(allPages, "gainers"),
    topDecliners: buildMovers(allPages, "decliners"),
    topOpportunities,
    topUnmanaged
  };
}

export async function getContentContext(
  ctx: PluginCtx,
  collection: string,
  id?: string,
  slug?: string
): Promise<ContentContextResponse> {
  const config = await requireConfig(ctx);
  const page = await findContentPage(ctx, collection, id, slug);
  if (!page) {
    throw new PluginRouteError("NOT_FOUND", "Analytics data not found for content", 404);
  }

  const contentRef =
    (await resolveContentRef(config.siteOrigin, page, collection, id, slug)) || {
      collection: "posts",
      id: page.contentId || id || pageStorageId(page.urlPath),
      slug: page.contentSlug || slug || null,
      urlPath: page.urlPath,
      title: page.title,
      excerpt: undefined,
      seoDescription: undefined
    };

  const queries = await getFreshQueriesForPage(ctx, config, contentRef.urlPath);
  const windows = buildWindows();
  const score = scorePage(page, queries);
  const freshness = await getFreshness(ctx);

  return {
    content: {
      collection: "posts",
      id: contentRef.id,
      slug: contentRef.slug,
      title: contentRef.title,
      urlPath: contentRef.urlPath,
      url: buildContentUrl(config.siteOrigin, contentRef.urlPath),
      excerpt: contentRef.excerpt ?? null,
      seoDescription: contentRef.seoDescription ?? null
    },
    analytics: {
      window: windows,
      page: {
        ...page,
        gscClicksDelta: page.gscClicks28d - page.gscClicksPrev28d,
        gscImpressionsDelta: page.gscImpressions28d - page.gscImpressionsPrev28d,
        gaViewsDelta: page.gaViews28d - page.gaViewsPrev28d,
        gaUsersDelta: page.gaUsers28d - page.gaUsersPrev28d,
        gaSessionsDelta: page.gaSessions28d - page.gaSessionsPrev28d
      },
      searchQueries: queries,
      opportunities: score.evidence,
      freshness
    }
  };
}

export async function listAgentKeys(ctx: PluginCtx): Promise<Array<Omit<AgentKeyRecord, "hash">>> {
  const result = await ctx.storage.agent_keys.query({
    orderBy: { createdAt: "desc" },
    limit: 100
  });
  return result.items.map((item) => {
    const record = item.data as AgentKeyRecord;
    return {
      prefix: record.prefix,
      label: record.label,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt
    };
  });
}

export async function createAgentKey(ctx: PluginCtx, label: string): Promise<{
  key: string;
  metadata: Omit<AgentKeyRecord, "hash">;
}> {
  const created = generatePrefixedToken(AGENT_KEY_PREFIX);
  const key = created.raw;
  const hash = hashPrefixedToken(key);
  const now = new Date().toISOString();

  const record: AgentKeyRecord = {
    prefix: created.prefix,
    hash,
    label,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null
  };
  await ctx.storage.agent_keys.put(hash, record);

  return {
    key,
    metadata: {
      prefix: record.prefix,
      label: record.label,
      createdAt: record.createdAt,
      lastUsedAt: null,
      revokedAt: null
    }
  };
}

export async function revokeAgentKey(ctx: PluginCtx, prefix: string): Promise<void> {
  const result = await ctx.storage.agent_keys.query({
    where: { prefix },
    limit: 1
  });
  const item = result.items[0];
  if (!item) {
    throw new PluginRouteError("NOT_FOUND", "Agent key not found", 404);
  }
  const record = item.data as AgentKeyRecord;
  record.revokedAt = new Date().toISOString();
  await ctx.storage.agent_keys.put(item.id, record);
}

export async function authenticateAgentRequest(ctx: PluginCtx, request: Request): Promise<void> {
  const token = extractAgentToken(request);
  if (!token.startsWith(AGENT_KEY_PREFIX)) {
    throw new PluginRouteError("UNAUTHORIZED", "Missing or invalid agent key", 401);
  }

  const hash = hashPrefixedToken(token);
  const record = await ctx.storage.agent_keys.get(hash);
  const keyRecord = record as AgentKeyRecord | null;
  if (!keyRecord || keyRecord.revokedAt) {
    throw new PluginRouteError("UNAUTHORIZED", "Missing or invalid agent key", 401);
  }

  keyRecord.lastUsedAt = new Date().toISOString();
  await ctx.storage.agent_keys.put(hash, keyRecord);
}

export function extractAgentToken(request: Request): string {
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("AgentKey ")) {
    return authHeader.slice("AgentKey ".length).trim();
  }

  const headerToken = request.headers.get("X-Emdash-Agent-Key") || "";
  if (headerToken.trim()) {
    return headerToken.trim();
  }

  return "";
}

export async function handleCron(ctx: PluginCtx, eventName: string): Promise<void> {
  if (eventName === CRON_SYNC_BASE) {
    await syncBase(ctx, CRON_SYNC_BASE);
    return;
  }
  if (eventName === CRON_ENRICH_MANAGED) {
    await enrichManagedQueries(ctx);
  }
}

async function requireConfig(ctx: PluginCtx): Promise<SavedPluginConfig> {
  const config = await loadConfig(ctx);
  if (!config) {
    throw new PluginRouteError("BAD_REQUEST", "Analytics connection is not configured", 400);
  }
  return config;
}

async function loadPage(ctx: PluginCtx, urlPath: string): Promise<PageAggregateRecord | null> {
  const page = await ctx.storage.pages.get(pageStorageId(urlPath));
  return (page as PageAggregateRecord | null) ?? null;
}

async function findContentPage(
  ctx: PluginCtx,
  collection: string,
  id?: string,
  slug?: string
): Promise<PageAggregateRecord | null> {
  if (id) {
    const byId = await ctx.storage.pages.query({
      where: {
        contentCollection: collection,
        contentId: id
      },
      limit: 1
    });
    const match = byId.items[0]?.data as PageAggregateRecord | undefined;
    if (match) return match;
  }

  if (slug) {
    const bySlug = await ctx.storage.pages.query({
      where: {
        contentCollection: collection,
        contentSlug: slug
      },
      limit: 1
    });
    const match = bySlug.items[0]?.data as PageAggregateRecord | undefined;
    if (match) return match;
  }

  return null;
}

async function resolveContentRef(
  siteOrigin: string,
  page: PageAggregateRecord,
  collection: string,
  id?: string,
  slug?: string
): Promise<ManagedContentRef | null> {
  if (collection !== "posts") {
    return {
      collection: "posts",
      id: page.contentId || id || pageStorageId(page.urlPath),
      slug: page.contentSlug || slug || null,
      urlPath: page.urlPath,
      title: page.title,
      excerpt: undefined,
      seoDescription: undefined
    };
  }

  const resolved = await resolveManagedContent(
    collection,
    page.contentId || id,
    page.contentSlug || slug || undefined,
    siteOrigin
  );
  if (resolved) {
    return resolved;
  }

  return {
    collection: "posts",
    id: page.contentId || id || pageStorageId(page.urlPath),
    slug: page.contentSlug || slug || null,
    urlPath: page.urlPath,
    title: page.title,
    excerpt: undefined,
    seoDescription: undefined
  };
}

async function getFreshQueriesForPage(
  ctx: PluginCtx,
  config: SavedPluginConfig,
  urlPath: string
): Promise<PageQueryRecord[]> {
  let queries = await getPageQueries(ctx, urlPath);
  const updatedAt = queries[0]?.updatedAt ? Date.parse(queries[0].updatedAt) : 0;
  const isStale = !updatedAt || Date.now() - updatedAt > QUERY_REFRESH_STALE_HOURS * 60 * 60 * 1000;
  if (!isStale || !ctx.http) return queries;

  const serviceAccount = parseServiceAccount(config.serviceAccountJson);
  const windows = buildWindows();
  const refreshed = await fetchGscPageQueries(
    ctx.http,
    config,
    serviceAccount,
    urlPath,
    windows.gscCurrent,
    GSC_QUERY_ROW_LIMIT
  );
  const existing = await ctx.storage.page_queries.query({
    where: { urlPath },
    limit: 100
  });
  if (existing.items.length > 0) {
    await ctx.storage.page_queries.deleteMany(existing.items.map((entry) => entry.id));
  }
  if (refreshed.length > 0) {
    const nowIso = new Date().toISOString();
    await ctx.storage.page_queries.putMany(
      refreshed.map((query) => ({
        id: pageQueryStorageId(urlPath, query.query),
        data: {
          urlPath,
          query: query.query,
          clicks28d: query.clicks,
          impressions28d: query.impressions,
          ctr28d: query.ctr,
          position28d: query.position,
          updatedAt: nowIso
        } satisfies PageQueryRecord
      }))
    );
  }
  queries = await getPageQueries(ctx, urlPath);
  const page = await loadPage(ctx, urlPath);
  if (page) {
    const rescored = scorePage(page, queries);
    page.opportunityScore = rescored.score;
    page.opportunityTags = rescored.tags;
    page.lastSyncedAt = new Date().toISOString();
    await ctx.storage.pages.put(pageStorageId(urlPath), page);
  }
  return queries;
}

async function getPageQueries(ctx: PluginCtx, urlPath: string): Promise<PageQueryRecord[]> {
  const result = await ctx.storage.page_queries.query({
    where: { urlPath },
    orderBy: { impressions28d: "desc" },
    limit: 50
  });
  return result.items.map((item) => item.data as PageQueryRecord);
}

async function getFreshness(ctx: PluginCtx): Promise<FreshnessState> {
  return (
    (await ctx.kv.get<FreshnessState>(FRESHNESS_KEY)) || {
      lastSyncedAt: null,
      lastGscDate: null,
      lastGaDate: null,
      lastStatus: "idle"
    }
  );
}

async function listAllPages(ctx: PluginCtx): Promise<PageAggregateRecord[]> {
  const pages: PageAggregateRecord[] = [];
  let cursor: string | undefined;
  do {
    const batch = await ctx.storage.pages.query({
      limit: 500,
      cursor
    });
    cursor = batch.cursor;
    pages.push(...batch.items.map((item) => item.data as PageAggregateRecord));
  } while (cursor);
  return pages;
}

async function refreshSummaryFromStorage(ctx: PluginCtx): Promise<void> {
  const windows = buildWindows();
  const allPages: PageAggregateRecord[] = [];
  let cursor: string | undefined;

  do {
    const pageBatch = await ctx.storage.pages.query({
      limit: 500,
      cursor
    });
    cursor = pageBatch.cursor;
    allPages.push(...pageBatch.items.map((item) => item.data as PageAggregateRecord));
  } while (cursor);

  const trendMap = new Map<string, { date: string; clicks: number; impressions: number; views: number; sessions: number; users: number }>();
  let dailyCursor: string | undefined;
  do {
    const batch = await ctx.storage.daily_metrics.query({
      limit: 1000,
      cursor: dailyCursor
    });
    dailyCursor = batch.cursor;
    for (const item of batch.items) {
      const row = item.data as DailyMetricRecord;
      let existing = trendMap.get(row.date);
      if (!existing) {
        existing = { date: row.date, clicks: 0, impressions: 0, views: 0, sessions: 0, users: 0 };
        trendMap.set(row.date, existing);
      }
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.views += row.views;
      existing.sessions += row.sessions;
      existing.users += row.users;
    }
  } while (dailyCursor);

  await ctx.kv.set(
    SITE_SUMMARY_KEY,
    buildSummary(allPages, Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date)), windows)
  );
}

async function writeSyncRun(ctx: PluginCtx, record: SyncRunRecord): Promise<void> {
  await ctx.storage.sync_runs.put(ulid(), record);
}

function buildSummary(
  pages: PageAggregateRecord[],
  trend: CombinedTrendMetric[],
  windows: SiteSummary["window"]
): SiteSummary {
  return {
    window: windows,
    totals: {
      gscClicks28d: pages.reduce((total, page) => total + page.gscClicks28d, 0),
      gscImpressions28d: pages.reduce((total, page) => total + page.gscImpressions28d, 0),
      gaViews28d: pages.reduce((total, page) => total + page.gaViews28d, 0),
      gaUsers28d: pages.reduce((total, page) => total + page.gaUsers28d, 0),
      gaSessions28d: pages.reduce((total, page) => total + page.gaSessions28d, 0),
      managedOpportunities: pages.filter((page) => page.managed && page.opportunityScore > 0).length,
      trackedPages: pages.length
    },
    trend: trend.map((row) => ({
      date: row.date,
      gscClicks: row.clicks,
      gscImpressions: row.impressions,
      gaViews: row.views,
      gaSessions: row.sessions,
      gaUsers: row.users
    }))
  };
}

function mergeTrend(
  gscTrend: Array<{ date: string; clicks: number; impressions: number }>,
  gaTrend: Array<{ date: string; views: number; sessions: number; users: number }>
): CombinedTrendMetric[] {
  const map = new Map<string, CombinedTrendMetric>();
  for (const row of gscTrend) {
    map.set(row.date, {
      date: row.date,
      clicks: row.clicks,
      impressions: row.impressions,
      views: 0,
      sessions: 0,
      users: 0
    });
  }
  for (const row of gaTrend) {
    const existing = map.get(row.date) || {
      date: row.date,
      clicks: 0,
      impressions: 0,
      views: 0,
      sessions: 0,
      users: 0
    };
    existing.views = row.views;
    existing.sessions = row.sessions;
    existing.users = row.users;
    map.set(row.date, existing);
  }
  return Array.from(map.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function buildKpiDeltas(pages: PageAggregateRecord[]): KpiDelta[] {
  const metrics: Array<Omit<KpiDelta, "delta">> = [
    {
      key: "gscClicks",
      label: "GSC Clicks",
      current: sumPages(pages, (page) => page.gscClicks28d),
      previous: sumPages(pages, (page) => page.gscClicksPrev28d)
    },
    {
      key: "gscImpressions",
      label: "GSC Impressions",
      current: sumPages(pages, (page) => page.gscImpressions28d),
      previous: sumPages(pages, (page) => page.gscImpressionsPrev28d)
    },
    {
      key: "gaViews",
      label: "GA Views",
      current: sumPages(pages, (page) => page.gaViews28d),
      previous: sumPages(pages, (page) => page.gaViewsPrev28d)
    },
    {
      key: "gaUsers",
      label: "GA Users",
      current: sumPages(pages, (page) => page.gaUsers28d),
      previous: sumPages(pages, (page) => page.gaUsersPrev28d)
    },
    {
      key: "gaSessions",
      label: "GA Sessions",
      current: sumPages(pages, (page) => page.gaSessions28d),
      previous: sumPages(pages, (page) => page.gaSessionsPrev28d)
    }
  ];

  return metrics.map((metric) => ({
    ...metric,
    delta: metric.current - metric.previous
  }));
}

function buildBreakdown(
  pages: PageAggregateRecord[],
  getKey: (page: PageAggregateRecord) => string,
  getLabel: (key: string) => string
): BreakdownRow[] {
  const buckets = new Map<string, BreakdownRow>();

  for (const page of pages) {
    const key = getKey(page);
    const existing = buckets.get(key) ?? {
      key,
      label: getLabel(key),
      trackedPages: 0,
      current: { gscClicks: 0, gaViews: 0, gaSessions: 0 },
      previous: { gscClicks: 0, gaViews: 0, gaSessions: 0 },
      delta: { gscClicks: 0, gaViews: 0, gaSessions: 0 }
    };

    existing.trackedPages += 1;
    existing.current.gscClicks += page.gscClicks28d;
    existing.current.gaViews += page.gaViews28d;
    existing.current.gaSessions += page.gaSessions28d;
    existing.previous.gscClicks += page.gscClicksPrev28d;
    existing.previous.gaViews += page.gaViewsPrev28d;
    existing.previous.gaSessions += page.gaSessionsPrev28d;
    existing.delta.gscClicks = existing.current.gscClicks - existing.previous.gscClicks;
    existing.delta.gaViews = existing.current.gaViews - existing.previous.gaViews;
    existing.delta.gaSessions = existing.current.gaSessions - existing.previous.gaSessions;
    buckets.set(key, existing);
  }

  return Array.from(buckets.values()).sort((left, right) => right.current.gaViews - left.current.gaViews);
}

function buildMovers(
  pages: PageAggregateRecord[],
  direction: "gainers" | "decliners"
): MoverRow[] {
  const rows = pages.map((page) => ({
    urlPath: page.urlPath,
    title: page.title,
    pageKind: page.pageKind,
    managed: page.managed,
    gscClicks28d: page.gscClicks28d,
    gaViews28d: page.gaViews28d,
    gscClicksDelta: page.gscClicks28d - page.gscClicksPrev28d,
    gaViewsDelta: page.gaViews28d - page.gaViewsPrev28d,
    opportunityScore: page.opportunityScore
  }));

  const filtered = rows.filter((row) =>
    direction === "gainers"
      ? row.gaViewsDelta > 0 || row.gscClicksDelta > 0
      : row.gaViewsDelta < 0 || row.gscClicksDelta < 0
  );

  filtered.sort((left, right) => {
    if (direction === "gainers") {
      return (
        right.gaViewsDelta - left.gaViewsDelta ||
        right.gscClicksDelta - left.gscClicksDelta ||
        right.gaViews28d - left.gaViews28d
      );
    }

    return (
      left.gaViewsDelta - right.gaViewsDelta ||
      left.gscClicksDelta - right.gscClicksDelta ||
      right.gaViews28d - left.gaViews28d
    );
  });

  return filtered.slice(0, 5);
}

function sumPages(
  pages: PageAggregateRecord[],
  getValue: (page: PageAggregateRecord) => number
): number {
  return pages.reduce((total, page) => total + getValue(page), 0);
}

function pageKindLabel(pageKind: PageAggregateRecord["pageKind"]): string {
  switch (pageKind) {
    case "blog_post":
      return "Blog Post";
    case "blog_archive":
      return "Blog Archive";
    case "tag":
      return "Tag";
    case "author":
      return "Author";
    case "landing":
      return "Landing";
    default:
      return "Other";
  }
}
