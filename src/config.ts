import { decrypt, encrypt } from "@emdash-cms/auth";
import type { PluginContext } from "emdash";

import {
  CONFIG_GA4_PROPERTY_ID_KEY,
  CONFIG_GSC_SITE_URL_KEY,
  CONFIG_SERVICE_ACCOUNT_KEY,
  CONFIG_SITE_ORIGIN_KEY
} from "./constants.js";
import { normalizeOrigin, parseServiceAccount, resolveConfigInput } from "./config-validation.js";
import type { PluginConfigSummary, SavedPluginConfig } from "./types.js";

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
  const resolved = resolveConfigInput({
    siteOrigin,
    ga4PropertyId,
    gscSiteUrl,
    serviceAccountJson
  });
  if (!resolved.success) {
    throw new Error(resolved.message);
  }
  return resolved.data;
}

export async function saveConfig(ctx: PluginCtx, input: SavedPluginConfig): Promise<PluginConfigSummary> {
  const resolved = resolveConfigInput(input);
  if (!resolved.success) {
    throw new Error(resolved.message);
  }
  const parsed = resolved.data;
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
