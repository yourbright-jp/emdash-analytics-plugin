import type { PluginDescriptor } from "emdash";
import {
  PluginRouteError,
  definePlugin
} from "emdash";
import { z } from "astro/zod";

import {
  createContentInsightAction,
  getContentInsightAction,
  linkContentInsightRevision,
  listContentInsightActions,
  recordContentInsightMeasurement,
  requireIdempotencyKey,
  updateContentInsightActionStatus
} from "./actions.js";
import {
  AGENT_SCOPE_CONTENT_INSIGHTS_WRITE,
  ADMIN_ROUTES,
  CRON_ENRICH_MANAGED,
  CRON_SYNC_BASE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  PUBLIC_AGENT_ROUTES
} from "./constants.js";
import { resolveConfigInput } from "./config-validation.js";
import { getConfigSummary, loadConfig, saveConfig } from "./config.js";
import {
  authenticateAgentRequest,
  createAgentKey,
  enrichManagedQueries,
  getContentContext,
  getOverview,
  getStatus,
  handleCron,
  listAgentKeys,
  listPages,
  revokeAgentKey,
  syncBase,
  testConnection
} from "./sync.js";

const agentKeyScopeSchema = z.enum(["analytics:read", "content-insights:write"]);
const actionStatusSchema = z.enum([
  "planned",
  "applied",
  "measuring",
  "improved",
  "neutral",
  "regressed",
  "rolled_back",
  "failed"
]);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const dateRangeSchema = z
  .object({
    startDate: isoDateSchema,
    endDate: isoDateSchema
  })
  .refine((range) => range.startDate <= range.endDate, {
    message: "startDate must be on or before endDate"
  });

const configSaveSchema = z.object({
  siteOrigin: z.string().optional(),
  ga4PropertyId: z.string().optional(),
  gscSiteUrl: z.string().optional(),
  serviceAccountJson: z.string().optional()
});

const pageListSchema = z.object({
  managed: z.enum(["all", "managed", "unmanaged"]).optional(),
  hasOpportunity: z.boolean().optional(),
  pageKind: z.enum(["all", "blog_post", "blog_archive", "tag", "author", "landing", "other"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional()
});

const contentContextSchema = z.object({
  collection: z.string().default("posts"),
  id: z.string().optional(),
  slug: z.string().optional()
});

const agentKeyCreateSchema = z.object({
  label: z.string().min(1).max(200),
  scopes: z.array(agentKeyScopeSchema).min(1).max(2).optional()
});

const agentKeyRevokeSchema = z.object({
  prefix: z.string().min(1)
});

const contentInsightActionCreateSchema = z
  .object({
    contentCollection: z.string().min(1).max(100).default("posts"),
    contentId: z.string().min(1).max(200),
    contentSlug: z.string().min(1).max(300).nullable().optional(),
    urlPath: z.string().min(1).max(1000).startsWith("/"),
    targetQuery: z.string().min(1).max(500).nullable().optional(),
    reason: z.string().min(1).max(2000),
    hypothesis: z.string().min(1).max(4000),
    changeSummary: z.string().min(1).max(4000),
    baselinePeriod: dateRangeSchema,
    measurementPeriod: dateRangeSchema,
    detectedAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "detectedAt must be an ISO timestamp")
      .optional()
  })
  .refine((action) => action.baselinePeriod.endDate < action.measurementPeriod.startDate, {
    message: "measurementPeriod must start after baselinePeriod ends"
  });

const contentInsightRevisionSchema = z.object({
  actionId: z.string().min(1).max(100),
  revisionId: z.string().min(1).max(200)
});

const contentInsightMeasurementSchema = z.object({
  actionId: z.string().min(1).max(100),
  phase: z.enum(["baseline", "post_change"]),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  clicks: z.number().int().min(0),
  impressions: z.number().int().min(0),
  position: z.number().min(0)
}).refine((measurement) => measurement.periodStart <= measurement.periodEnd, {
  message: "periodStart must be on or before periodEnd"
});

const contentInsightStatusSchema = z.object({
  actionId: z.string().min(1).max(100),
  status: actionStatusSchema
});

type ConfigSaveInput = z.infer<typeof configSaveSchema>;
type PageListInput = z.infer<typeof pageListSchema>;
type ContentContextInput = z.infer<typeof contentContextSchema>;
type AgentKeyCreateInput = z.infer<typeof agentKeyCreateSchema>;
type AgentKeyRevokeInput = z.infer<typeof agentKeyRevokeSchema>;

export function contentInsightsPlugin(): PluginDescriptor {
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    entrypoint: "@yourbright/emdash-analytics-plugin",
    adminEntry: "@yourbright/emdash-analytics-plugin/admin",
    capabilities: ["network:fetch", "read:content"],
    allowedHosts: [
      "oauth2.googleapis.com",
      "analyticsdata.googleapis.com",
      "www.googleapis.com"
    ],
    adminPages: [
      { path: "/", label: "Analytics", icon: "chart-bar" }
    ],
    adminWidgets: [
      { id: "content-opportunities", title: "Content Opportunities", size: "full" }
    ],
    options: {}
  };
}

export function createPlugin() {
  return definePlugin({
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    capabilities: ["network:fetch", "read:content"],
    allowedHosts: [
      "oauth2.googleapis.com",
      "analyticsdata.googleapis.com",
      "www.googleapis.com"
    ],
    storage: {
      pages: {
        indexes: [
          "managed",
          "pageKind",
          "opportunityScore",
          "gaViews28d",
          "urlPath",
          "contentCollection",
          "contentId",
          "contentSlug"
        ],
        uniqueIndexes: ["urlPath"]
      },
      page_queries: {
        indexes: ["urlPath", "impressions28d", "updatedAt"],
        uniqueIndexes: [["urlPath", "query"]]
      },
      daily_metrics: {
        indexes: ["source", "scope", "date"],
        uniqueIndexes: [["source", "scope", "date"]]
      },
      sync_runs: {
        indexes: ["jobType", "status", "startedAt"]
      },
      agent_keys: {
        indexes: ["prefix", "createdAt", "revokedAt"],
        uniqueIndexes: ["hash", "prefix"]
      },
      content_insight_actions: {
        indexes: [
          "status",
          "contentKey",
          "openContentKey",
          "contentId",
          "urlPath",
          "emdashRevisionId",
          "updatedAt"
        ],
        uniqueIndexes: ["idempotencyKeyHash", "openContentKey"]
      },
      content_insight_action_events: {
        indexes: ["actionId", "eventType", "createdAt"],
        uniqueIndexes: ["idempotencyKeyHash"]
      },
      content_insight_measurements: {
        indexes: [
          "actionId",
          "phase",
          "source",
          "periodStart",
          "periodEnd",
          "recordedAt"
        ],
        uniqueIndexes: ["idempotencyKeyHash", ["actionId", "phase", "periodStart", "periodEnd"]]
      }
    },
    hooks: {
      "plugin:activate": {
        handler: async (_event, ctx) => {
          if (ctx.cron) {
            await ctx.cron.schedule(CRON_SYNC_BASE, { schedule: "0 */6 * * *" });
            await ctx.cron.schedule(CRON_ENRICH_MANAGED, { schedule: "0 2 * * *" });
          }
        }
      },
      cron: {
        handler: async (event, ctx) => {
          await handleCron(ctx, event.name);
        }
      }
    },
    routes: {
      [ADMIN_ROUTES.STATUS]: {
        handler: async (ctx) => getStatus(ctx)
      },
      [ADMIN_ROUTES.OVERVIEW]: {
        handler: async (ctx) => getOverview(ctx)
      },
      [ADMIN_ROUTES.LIST_PAGES]: {
        input: pageListSchema,
        handler: async (ctx) => listPages(ctx, ctx.input as PageListInput)
      },
      [ADMIN_ROUTES.CONTENT_CONTEXT]: {
        input: contentContextSchema,
        handler: async (ctx) => {
          const input = ctx.input as ContentContextInput;
          return getContentContext(ctx, input.collection, input.id, input.slug);
        }
      },
      [ADMIN_ROUTES.CONFIG_GET]: {
        handler: async (ctx) => getConfigSummary(ctx)
      },
      [ADMIN_ROUTES.CONFIG_SAVE]: {
        input: configSaveSchema,
        handler: async (ctx) => {
          const input = ctx.input as ConfigSaveInput;
          const current = await loadConfig(ctx);
          const resolved = resolveConfigInput(input, current);
          if (!resolved.success) {
            throw new PluginRouteError("BAD_REQUEST", resolved.message, 400);
          }
          return saveConfig(ctx, resolved.data);
        }
      },
      [ADMIN_ROUTES.CONNECTION_TEST]: {
        input: configSaveSchema,
        handler: async (ctx) => {
          const input = ctx.input as Partial<ConfigSaveInput>;
          const current = await loadConfig(ctx);
          const resolved = resolveConfigInput(input, current);
          if (!resolved.success) {
            throw new PluginRouteError("BAD_REQUEST", resolved.message, 400);
          }
          try {
            return testConnection(ctx, resolved.data);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Connection test failed";
            console.error("[analytics-plugin] connection test failed", error);
            throw new PluginRouteError("INTERNAL_ERROR", message, 500);
          }
        }
      },
      [ADMIN_ROUTES.SYNC_NOW]: {
        handler: async (ctx) => {
          try {
            const base = await syncBase(ctx, "manual");
            const enriched = await enrichManagedQueries(ctx);
            return { ...base, ...enriched };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Manual sync failed";
            console.error("[analytics-plugin] manual sync failed", error);
            throw new PluginRouteError("INTERNAL_ERROR", message, 500);
          }
        }
      },
      [ADMIN_ROUTES.AGENT_KEYS_LIST]: {
        handler: async (ctx) => listAgentKeys(ctx)
      },
      [ADMIN_ROUTES.AGENT_KEYS_CREATE]: {
        input: agentKeyCreateSchema,
        handler: async (ctx) => {
          const input = ctx.input as AgentKeyCreateInput;
          return createAgentKey(ctx, input.label, input.scopes);
        }
      },
      [ADMIN_ROUTES.AGENT_KEYS_REVOKE]: {
        input: agentKeyRevokeSchema,
        handler: async (ctx) => {
          await revokeAgentKey(ctx, (ctx.input as AgentKeyRevokeInput).prefix);
          return { success: true };
        }
      },
      [PUBLIC_AGENT_ROUTES.SITE_SUMMARY]: {
        public: true,
        handler: async (ctx) => {
          await authenticateAgentRequest(ctx, ctx.request);
          const overview = await getOverview(ctx);
          return {
            summary: overview.summary,
            freshness: overview.freshness
          };
        }
      },
      [PUBLIC_AGENT_ROUTES.OPPORTUNITIES]: {
        public: true,
        handler: async (ctx) => {
          await authenticateAgentRequest(ctx, ctx.request);
          return listPages(ctx, {
            managed: "managed",
            hasOpportunity: true,
            limit: parsePositiveInt(new URL(ctx.request.url).searchParams.get("limit")) || 50,
            cursor: new URL(ctx.request.url).searchParams.get("cursor") || undefined
          });
        }
      },
      [PUBLIC_AGENT_ROUTES.CONTENT_CONTEXT]: {
        public: true,
        handler: async (ctx) => {
          await authenticateAgentRequest(ctx, ctx.request);
          const params = new URL(ctx.request.url).searchParams;
          const collection = params.get("collection") || "posts";
          const id = params.get("id") || undefined;
          const slug = params.get("slug") || undefined;
          if (!id && !slug) {
            throw new PluginRouteError("BAD_REQUEST", "id or slug is required", 400);
          }
          try {
            return getContentContext(ctx, collection, id, slug);
          } catch (error) {
            console.error("[analytics-plugin] content-context failed", {
              collection,
              id,
              slug,
              error: error instanceof Error ? {
                name: error.name,
                message: error.message,
                stack: error.stack
              } : String(error)
            });
            throw error;
          }
        }
      },
      [PUBLIC_AGENT_ROUTES.ACTIONS]: {
        public: true,
        handler: async (ctx) => {
          if (ctx.request.method === "GET") {
            await authenticateAgentRequest(ctx, ctx.request);
            const params = new URL(ctx.request.url).searchParams;
            const actionId = params.get("id")?.trim();
            if (actionId) {
              return getContentInsightAction(ctx, actionId);
            }
            const rawStatus = params.get("status");
            const parsedStatus = rawStatus ? actionStatusSchema.safeParse(rawStatus) : null;
            if (parsedStatus && !parsedStatus.success) {
              throw new PluginRouteError("BAD_REQUEST", "Invalid action status", 400);
            }
            return listContentInsightActions(ctx, {
              status: parsedStatus?.success ? parsedStatus.data : undefined,
              contentId: params.get("contentId")?.trim() || undefined,
              limit: Math.min(parsePositiveInt(params.get("limit")) || 50, 100),
              cursor: params.get("cursor") || undefined
            });
          }
          requireMethod(ctx.request, "POST");
          const agent = await authenticateAgentRequest(
            ctx,
            ctx.request,
            AGENT_SCOPE_CONTENT_INSIGHTS_WRITE
          );
          const input = parseRouteInput(contentInsightActionCreateSchema, ctx.input);
          return createContentInsightAction(
            ctx,
            input,
            requireIdempotencyKey(ctx.request),
            agent.prefix
          );
        }
      },
      [PUBLIC_AGENT_ROUTES.ACTION_LINK_REVISION]: {
        public: true,
        input: contentInsightRevisionSchema,
        handler: async (ctx) => {
          requireMethod(ctx.request, "POST");
          const agent = await authenticateAgentRequest(
            ctx,
            ctx.request,
            AGENT_SCOPE_CONTENT_INSIGHTS_WRITE
          );
          const input = ctx.input as z.infer<typeof contentInsightRevisionSchema>;
          return linkContentInsightRevision(
            ctx,
            input.actionId,
            input.revisionId,
            requireIdempotencyKey(ctx.request),
            agent.prefix
          );
        }
      },
      [PUBLIC_AGENT_ROUTES.ACTION_MEASUREMENTS]: {
        public: true,
        input: contentInsightMeasurementSchema,
        handler: async (ctx) => {
          requireMethod(ctx.request, "POST");
          const agent = await authenticateAgentRequest(
            ctx,
            ctx.request,
            AGENT_SCOPE_CONTENT_INSIGHTS_WRITE
          );
          return recordContentInsightMeasurement(
            ctx,
            ctx.input as z.infer<typeof contentInsightMeasurementSchema>,
            requireIdempotencyKey(ctx.request),
            agent.prefix
          );
        }
      },
      [PUBLIC_AGENT_ROUTES.ACTION_STATUS]: {
        public: true,
        input: contentInsightStatusSchema,
        handler: async (ctx) => {
          requireMethod(ctx.request, "POST");
          const agent = await authenticateAgentRequest(
            ctx,
            ctx.request,
            AGENT_SCOPE_CONTENT_INSIGHTS_WRITE
          );
          const input = ctx.input as z.infer<typeof contentInsightStatusSchema>;
          return updateContentInsightActionStatus(
            ctx,
            input.actionId,
            input.status,
            requireIdempotencyKey(ctx.request),
            agent.prefix
          );
        }
      }
    },
    admin: {
      pages: [
        { path: "/", label: "Analytics", icon: "chart-bar" }
      ],
      widgets: [
        { id: "content-opportunities", title: "Content Opportunities", size: "full" }
      ]
    }
  });
}

export default createPlugin;

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function requireMethod(request: Request, expected: "POST"): void {
  if (request.method !== expected) {
    throw new PluginRouteError("METHOD_NOT_ALLOWED", `Use ${expected} for this endpoint`, 405);
  }
}

function parseRouteInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PluginRouteError(
      "VALIDATION_ERROR",
      "Invalid request body",
      400,
      parsed.error.format()
    );
  }
  return parsed.data;
}
