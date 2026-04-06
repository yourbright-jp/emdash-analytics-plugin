import type { PluginDescriptor } from "emdash";
import {
  PluginRouteError,
  definePlugin
} from "emdash";
import { z } from "astro/zod";

import {
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
  label: z.string().min(1).max(200)
});

const agentKeyRevokeSchema = z.object({
  prefix: z.string().min(1)
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
        handler: async (ctx) => createAgentKey(ctx, (ctx.input as AgentKeyCreateInput).label)
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
