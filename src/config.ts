import { decrypt, encrypt } from "@emdash-cms/auth";
import type { PluginContext } from "emdash";
import { z } from "astro/zod";

import {
  CONFIG_GA4_PROPERTY_ID_KEY,
  CONFIG_GSC_SITE_URL_KEY,
  CONFIG_SERVICE_ACCOUNT_KEY,
  CONFIG_SITE_ORIGIN_KEY
} from "./constants.js";
import type { GoogleServiceAccount, PluginConfigSummary, SavedPluginConfig } from "./types.js";

const configSchema = z.object({
  siteOrigin: z.string().url(),
  ga4PropertyId: z.string().regex(/^[0-9]+$/, "GA4 property ID must be numeric"),
  gscSiteUrl: z.string().min(1),
  serviceAccountJson: z.string().min(1)
});

type PluginCtx = PluginContext;

export async function loadConfig(ctx: PluginCtx): Promise<SavedPluginConfig | null> {
  const [siteOrigin, ga4PropertyId, gscSiteUrl, serviceAccountCiphertext] = await Promise.all([
    ctx.kv.get<string>(CONFIG_SITE_ORIGIN_KEY),
    ctx.kv.get<string>(CONFIG_GA4_PROPERTY_ID_KEY),
    ctx.kv.get<string>(CONFIG_GSC_SITE_URL_KEY),
    ctx.kv.get<string>(CONFIG_SERVICE_ACCOUNT_KEY)
  ]);

  if (!siteOrigin || !ga4PropertyId || !gscSiteUrl || !serviceAccountCiphertext) {
    return null;
  }

  const authSecret = getAuthSecret();
  const serviceAccountJson = await decrypt(serviceAccountCiphertext, authSecret);
  return configSchema.parse({
    siteOrigin,
    ga4PropertyId,
    gscSiteUrl,
    serviceAccountJson
  });
}

export async function saveConfig(ctx: PluginCtx, input: SavedPluginConfig): Promise<PluginConfigSummary> {
  const parsed = configSchema.parse(input);
  const authSecret = getAuthSecret();
  const serviceAccountCiphertext = await encrypt(parsed.serviceAccountJson, authSecret);

  await Promise.all([
    ctx.kv.set(CONFIG_SITE_ORIGIN_KEY, normalizeOrigin(parsed.siteOrigin)),
    ctx.kv.set(CONFIG_GA4_PROPERTY_ID_KEY, parsed.ga4PropertyId),
    ctx.kv.set(CONFIG_GSC_SITE_URL_KEY, parsed.gscSiteUrl),
    ctx.kv.set(CONFIG_SERVICE_ACCOUNT_KEY, serviceAccountCiphertext)
  ]);

  return summarizeConfig(parsed);
}

export async function getConfigSummary(ctx: PluginCtx): Promise<PluginConfigSummary> {
  const config = await loadConfig(ctx);
  if (!config) {
    return {
      siteOrigin: "",
      ga4PropertyId: "",
      gscSiteUrl: "",
      hasServiceAccount: false
    };
  }
  return summarizeConfig(config);
}

export function parseServiceAccount(json: string): GoogleServiceAccount {
  const schema = z.object({
    client_email: z.string().email(),
    private_key: z.string().min(1),
    token_uri: z.string().url().optional()
  });
  return schema.parse(JSON.parse(json));
}

export function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export function getAuthSecret(): string {
  const value = process.env.EMDASH_AUTH_SECRET || process.env.AUTH_SECRET || "";
  if (!value) {
    throw new Error("EMDASH_AUTH_SECRET is required to store analytics credentials");
  }
  return value;
}

function summarizeConfig(config: SavedPluginConfig): PluginConfigSummary {
  const serviceAccount = parseServiceAccount(config.serviceAccountJson);
  return {
    siteOrigin: normalizeOrigin(config.siteOrigin),
    ga4PropertyId: config.ga4PropertyId,
    gscSiteUrl: config.gscSiteUrl,
    hasServiceAccount: true,
    serviceAccountEmail: serviceAccount.client_email
  };
}
