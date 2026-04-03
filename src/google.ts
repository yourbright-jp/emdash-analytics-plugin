import type { HttpAccess } from "emdash";

import {
  GA_SCOPE,
  GOOGLE_GA_BASE_URL,
  GOOGLE_GSC_BASE_URL,
  GOOGLE_TOKEN_URL,
  GSC_DATA_DELAY_DAYS,
  GSC_SCOPE
} from "./constants.js";
import { buildContentUrl, normalizePath } from "./content.js";
import type { GoogleServiceAccount, SavedPluginConfig } from "./types.js";

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

interface DateWindow {
  startDate: string;
  endDate: string;
}

export interface Windows {
  gscCurrent: DateWindow;
  gscPrevious: DateWindow;
  gaCurrent: DateWindow;
  gaPrevious: DateWindow;
}

export interface GscPageMetric {
  urlPath: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryMetric {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GaPageMetric {
  urlPath: string;
  views: number;
  users: number;
  sessions: number;
  engagementRate: number;
  bounceRate: number;
  averageSessionDuration: number;
}

export interface TrendMetric {
  date: string;
  clicks: number;
  impressions: number;
  views: number;
  sessions: number;
  users: number;
}

export function buildWindows(now = new Date()): Windows {
  const gaCurrentEnd = addDaysUtc(now, -1);
  const gaCurrentStart = addDaysUtc(gaCurrentEnd, -27);
  const gaPreviousEnd = addDaysUtc(gaCurrentStart, -1);
  const gaPreviousStart = addDaysUtc(gaPreviousEnd, -27);

  const gscCurrentEnd = addDaysUtc(now, -GSC_DATA_DELAY_DAYS);
  const gscCurrentStart = addDaysUtc(gscCurrentEnd, -27);
  const gscPreviousEnd = addDaysUtc(gscCurrentStart, -1);
  const gscPreviousStart = addDaysUtc(gscPreviousEnd, -27);

  return {
    gscCurrent: { startDate: formatDate(gscCurrentStart), endDate: formatDate(gscCurrentEnd) },
    gscPrevious: { startDate: formatDate(gscPreviousStart), endDate: formatDate(gscPreviousEnd) },
    gaCurrent: { startDate: formatDate(gaCurrentStart), endDate: formatDate(gaCurrentEnd) },
    gaPrevious: { startDate: formatDate(gaPreviousStart), endDate: formatDate(gaPreviousEnd) }
  };
}

export async function runConnectionTest(
  http: HttpAccess,
  config: SavedPluginConfig,
  serviceAccount: GoogleServiceAccount
): Promise<{ ga: Record<string, unknown>; gsc: Record<string, unknown> }> {
  const gaToken = await getGoogleAccessToken(http, serviceAccount, [GA_SCOPE]);
  const gscToken = await getGoogleAccessToken(http, serviceAccount, [GSC_SCOPE]);
  const windows = buildWindows();

  const ga = await postJson(
    http,
    `${GOOGLE_GA_BASE_URL}/properties/${config.ga4PropertyId}:runReport`,
    gaToken,
    {
      dateRanges: [windows.gaCurrent],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }],
      limit: 1
    }
  );

  const gsc = await postJson(
    http,
    `${GOOGLE_GSC_BASE_URL}/sites/${encodeURIComponent(config.gscSiteUrl)}/searchAnalytics/query`,
    gscToken,
    {
      startDate: windows.gscCurrent.startDate,
      endDate: windows.gscCurrent.endDate,
      dimensions: ["date"],
      rowLimit: 1,
      startRow: 0
    }
  );

  return {
    ga: {
      rowCount: numberOrZero(ga.rowCount),
      sample: Array.isArray(ga.rows) ? ga.rows[0] ?? null : null
    },
    gsc: {
      rowCount: Array.isArray(gsc.rows) ? gsc.rows.length : 0,
      sample: Array.isArray(gsc.rows) ? gsc.rows[0] ?? null : null
    }
  };
}

export async function fetchGscPageMetrics(
  http: HttpAccess,
  config: SavedPluginConfig,
  serviceAccount: GoogleServiceAccount,
  window: DateWindow
): Promise<GscPageMetric[]> {
  const token = await getGoogleAccessToken(http, serviceAccount, [GSC_SCOPE]);
  const rows: GscPageMetric[] = [];
  const canonicalHost = new URL(config.siteOrigin).hostname;

  let startRow = 0;
  while (true) {
    const body = await postJson(
      http,
      `${GOOGLE_GSC_BASE_URL}/sites/${encodeURIComponent(config.gscSiteUrl)}/searchAnalytics/query`,
      token,
      {
        startDate: window.startDate,
        endDate: window.endDate,
        dimensions: ["page"],
        rowLimit: 25000,
        startRow,
        type: "web"
      }
    );

    const pageRows = Array.isArray(body.rows) ? body.rows : [];
    for (const row of pageRows) {
      const rawUrl = stringValue(row.keys?.[0]);
      if (!rawUrl) continue;
      const urlPath = normalizePath(rawUrl, canonicalHost);
      if (!urlPath) continue;
      rows.push({
        urlPath,
        clicks: numberOrZero(row.clicks),
        impressions: numberOrZero(row.impressions),
        ctr: numberOrZero(row.ctr),
        position: numberOrZero(row.position)
      });
    }

    if (pageRows.length < 25000) break;
    startRow += 25000;
  }

  return rows;
}

export async function fetchGscDailyTrend(
  http: HttpAccess,
  config: SavedPluginConfig,
  serviceAccount: GoogleServiceAccount,
  window: DateWindow
): Promise<TrendMetric[]> {
  const token = await getGoogleAccessToken(http, serviceAccount, [GSC_SCOPE]);
  const body = await postJson(
    http,
    `${GOOGLE_GSC_BASE_URL}/sites/${encodeURIComponent(config.gscSiteUrl)}/searchAnalytics/query`,
    token,
    {
      startDate: window.startDate,
      endDate: window.endDate,
      dimensions: ["date"],
      rowLimit: 1000,
      startRow: 0,
      type: "web"
    }
  );

  return (Array.isArray(body.rows) ? body.rows : []).map((row) => ({
    date: stringValue(row.keys?.[0]) || window.startDate,
    clicks: numberOrZero(row.clicks),
    impressions: numberOrZero(row.impressions),
    views: 0,
    sessions: 0,
    users: 0
  }));
}

export async function fetchGscPageQueries(
  http: HttpAccess,
  config: SavedPluginConfig,
  serviceAccount: GoogleServiceAccount,
  urlPath: string,
  window: DateWindow,
  limit: number
): Promise<GscQueryMetric[]> {
  const token = await getGoogleAccessToken(http, serviceAccount, [GSC_SCOPE]);
  const pageUrl = buildContentUrl(config.siteOrigin, urlPath);
  const body = await postJson(
    http,
    `${GOOGLE_GSC_BASE_URL}/sites/${encodeURIComponent(config.gscSiteUrl)}/searchAnalytics/query`,
    token,
    {
      startDate: window.startDate,
      endDate: window.endDate,
      dimensions: ["query"],
      rowLimit: limit,
      startRow: 0,
      type: "web",
      dimensionFilterGroups: [
        {
          filters: [
            {
              dimension: "page",
              operator: "equals",
              expression: pageUrl
            }
          ]
        }
      ]
    }
  );

  return (Array.isArray(body.rows) ? body.rows : []).map((row) => ({
    query: stringValue(row.keys?.[0]) || "",
    clicks: numberOrZero(row.clicks),
    impressions: numberOrZero(row.impressions),
    ctr: numberOrZero(row.ctr),
    position: numberOrZero(row.position)
  })).filter((row) => row.query.length > 0);
}

export async function fetchGaPageMetrics(
  http: HttpAccess,
  config: SavedPluginConfig,
  serviceAccount: GoogleServiceAccount,
  window: DateWindow
): Promise<GaPageMetric[]> {
  const token = await getGoogleAccessToken(http, serviceAccount, [GA_SCOPE]);
  const rows: GaPageMetric[] = [];
  let offset = 0;
  const limit = 10000;

  while (true) {
    const body = await postJson(
      http,
      `${GOOGLE_GA_BASE_URL}/properties/${config.ga4PropertyId}:runReport`,
      token,
      {
        dateRanges: [window],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "engagementRate" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" }
        ],
        dimensionFilter: {
          filter: {
            fieldName: "hostName",
            stringFilter: {
              matchType: "EXACT",
              value: new URL(config.siteOrigin).hostname
            }
          }
        },
        limit,
        offset
      }
    );

    const pageRows = Array.isArray(body.rows) ? body.rows : [];
    for (const row of pageRows) {
      const urlPath = normalizePath(stringValue(row.dimensionValues?.[0]?.value) || "/");
      if (!urlPath) continue;
      rows.push({
        urlPath,
        views: numberOrZero(row.metricValues?.[0]?.value),
        users: numberOrZero(row.metricValues?.[1]?.value),
        sessions: numberOrZero(row.metricValues?.[2]?.value),
        engagementRate: numberOrZero(row.metricValues?.[3]?.value),
        bounceRate: numberOrZero(row.metricValues?.[4]?.value),
        averageSessionDuration: numberOrZero(row.metricValues?.[5]?.value)
      });
    }

    if (pageRows.length < limit) break;
    offset += limit;
  }

  return rows;
}

export async function fetchGaDailyTrend(
  http: HttpAccess,
  config: SavedPluginConfig,
  serviceAccount: GoogleServiceAccount,
  window: DateWindow
): Promise<TrendMetric[]> {
  const token = await getGoogleAccessToken(http, serviceAccount, [GA_SCOPE]);
  const body = await postJson(
    http,
    `${GOOGLE_GA_BASE_URL}/properties/${config.ga4PropertyId}:runReport`,
    token,
    {
      dateRanges: [window],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
        { name: "sessions" }
      ],
      dimensionFilter: {
        filter: {
          fieldName: "hostName",
          stringFilter: {
            matchType: "EXACT",
            value: new URL(config.siteOrigin).hostname
          }
        }
      },
      limit: 1000
    }
  );

  return (Array.isArray(body.rows) ? body.rows : []).map((row) => ({
    date: parseGaDate(stringValue(row.dimensionValues?.[0]?.value) || window.startDate),
    clicks: 0,
    impressions: 0,
    views: numberOrZero(row.metricValues?.[0]?.value),
    users: numberOrZero(row.metricValues?.[1]?.value),
    sessions: numberOrZero(row.metricValues?.[2]?.value)
  }));
}

async function getGoogleAccessToken(
  http: HttpAccess,
  serviceAccount: GoogleServiceAccount,
  scopes: string[]
): Promise<string> {
  const cacheKey = `${serviceAccount.client_email}:${scopes.join(" ")}`;
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const assertion = await createJwtAssertion(serviceAccount, scopes);
  const response = await http.fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });

  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(`Failed to obtain Google access token: ${body.error_description || body.error || response.status}`);
  }

  const token = stringValue(body.access_token);
  const expiresIn = numberOrZero(body.expires_in) || 3600;
  if (!token) {
    throw new Error("Google token response did not include access_token");
  }

  accessTokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresIn * 1000
  });
  return token;
}

async function createJwtAssertion(
  serviceAccount: GoogleServiceAccount,
  scopes: string[]
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: scopes.join(" "),
    aud: serviceAccount.token_uri || GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaims = base64url(JSON.stringify(claims));
  const payload = `${encodedHeader}.${encodedClaims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(payload)
  );
  return `${payload}.${base64urlBytes(new Uint8Array(signature))}`;
}

async function postJson(
  http: HttpAccess,
  url: string,
  accessToken: string,
  payload: Record<string, unknown>
): Promise<Record<string, any>> {
  const response = await http.fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await parseJson(response);
  if (!response.ok) {
    const message = body.error?.message || body.error_description || response.statusText;
    throw new Error(`Google API request failed: ${message}`);
  }
  return body;
}

async function parseJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return { rawText: text };
  }
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function base64url(value: string): string {
  return base64urlBytes(new TextEncoder().encode(value));
}

function base64urlBytes(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseGaDate(value: string): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value;
}

function addDaysUtc(date: Date, delta: number): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
