export const PLUGIN_ID = "emdash-google-analytics-dashboard";
export const PLUGIN_VERSION = "0.4.2";
export const AGENT_KEY_PREFIX = "yb_ins_";
export const AGENT_SCOPE_ANALYTICS_READ = "analytics:read";
export const AGENT_SCOPE_ANALYTICS_SYNC = "analytics:sync";
export const AGENT_SCOPE_CONTENT_INSIGHTS_WRITE = "content-insights:write";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_GA_BASE_URL = "https://analyticsdata.googleapis.com/v1beta";
export const GOOGLE_GSC_BASE_URL = "https://www.googleapis.com/webmasters/v3";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export const DEFAULT_PAGE_WINDOW_DAYS = 28;
export const GSC_DATA_DELAY_DAYS = 3;
export const QUERY_REFRESH_STALE_HOURS = 48;
export const GSC_QUERY_PAGE_LIMIT = 50;
export const GSC_QUERY_ROW_LIMIT = 25;

export const SITE_SUMMARY_KEY = "state:site-summary";
export const FRESHNESS_KEY = "state:freshness";
export const CONFIG_SITE_ORIGIN_KEY = "settings:siteOrigin";
export const CONFIG_GA4_PROPERTY_ID_KEY = "settings:ga4PropertyId";
export const CONFIG_GSC_SITE_URL_KEY = "settings:gscSiteUrl";
export const CONFIG_SERVICE_ACCOUNT_KEY = "settings:serviceAccountCiphertext";

export const CRON_SYNC_BASE = "sync-base";
export const CRON_ENRICH_MANAGED = "enrich-managed-queries";
export const CRON_AGENT_SYNC_PREFIX = "agent-sync-";

export const PUBLIC_AGENT_ROUTES = {
  SITE_SUMMARY: "agent/v1/site-summary",
  OPPORTUNITIES: "agent/v1/opportunities",
  CONTENT_CONTEXT: "agent/v1/content-context",
  SYNC: "agent/v1/sync",
  ACTIONS: "agent/v1/actions",
  ACTION_LINK_REVISION: "agent/v1/actions/link-revision",
  ACTION_MEASUREMENTS: "agent/v1/actions/measurements",
  ACTION_STATUS: "agent/v1/actions/status"
} as const;

export const ADMIN_ROUTES = {
  STATUS: "admin/status",
  OVERVIEW: "admin/overview",
  LIST_PAGES: "admin/pages/list",
  CONTENT_CONTEXT: "admin/content/get",
  CONFIG_GET: "admin/config/get",
  CONFIG_SAVE: "admin/config/save",
  CONNECTION_TEST: "admin/connection/test",
  SYNC_NOW: "admin/sync-now",
  AGENT_KEYS_LIST: "admin/agent-keys/list",
  AGENT_KEYS_CREATE: "admin/agent-keys/create",
  AGENT_KEYS_REVOKE: "admin/agent-keys/revoke"
} as const;

export const PAGE_KIND_ORDER = [
  "blog_post",
  "blog_archive",
  "tag",
  "author",
  "landing",
  "other"
] as const;
