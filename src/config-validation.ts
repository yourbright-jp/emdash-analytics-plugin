import { z } from "astro/zod";

import type { GoogleServiceAccount, SavedPluginConfig } from "./types.js";

export interface ConfigDraftInput {
  siteOrigin?: string;
  ga4PropertyId?: string;
  gscSiteUrl?: string;
  serviceAccountJson?: string;
}

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };

const serviceAccountSchema = z.object({
  client_email: z.string().email("Service Account JSON must include a valid client_email"),
  private_key: z.string().min(1, "Service Account JSON must include a private_key"),
  token_uri: z.string().url().optional()
});

const savedConfigSchema = z.object({
  siteOrigin: z
    .string()
    .min(1, "Canonical Site Origin is required")
    .refine(isHttpUrl, "Canonical Site Origin must be a valid http(s) URL"),
  ga4PropertyId: z
    .string()
    .min(1, "GA4 Property ID is required")
    .regex(/^[0-9]+$/, "GA4 Property ID must be numeric"),
  gscSiteUrl: z
    .string()
    .min(1, "Search Console Property is required")
    .refine(isValidSearchConsoleProperty, "Search Console Property must be a valid URL or sc-domain property"),
  serviceAccountJson: z
    .string()
    .min(1, "Service Account JSON is required")
    .superRefine((value, ctx) => {
      const parsed = parseServiceAccountSafe(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parsed.message
        });
      }
    })
});

export function resolveConfigInput(
  input: ConfigDraftInput | null | undefined,
  current: SavedPluginConfig | null = null
): ValidationResult<SavedPluginConfig> {
  const candidate = {
    siteOrigin: resolveField(input?.siteOrigin, current?.siteOrigin),
    ga4PropertyId: resolveField(input?.ga4PropertyId, current?.ga4PropertyId),
    gscSiteUrl: resolveField(input?.gscSiteUrl, current?.gscSiteUrl),
    serviceAccountJson: resolveServiceAccountField(input?.serviceAccountJson, current?.serviceAccountJson)
  };

  const parsed = savedConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      success: false,
      message: formatValidationError(parsed.error)
    };
  }

  return {
    success: true,
    data: {
      ...parsed.data,
      siteOrigin: normalizeOrigin(parsed.data.siteOrigin)
    }
  };
}

export function parseServiceAccount(json: string): GoogleServiceAccount {
  const result = parseServiceAccountSafe(json);
  if (!result.success) {
    throw new Error(result.message);
  }
  return result.data;
}

export function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function parseServiceAccountSafe(json: string): ValidationResult<GoogleServiceAccount> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(json);
  } catch {
    return {
      success: false,
      message: "Service Account JSON must be valid JSON"
    };
  }

  const parsed = serviceAccountSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      success: false,
      message: formatValidationError(parsed.error)
    };
  }

  return {
    success: true,
    data: parsed.data
  };
}

function resolveField(value: string | undefined, fallback: string | undefined): string {
  if (value === undefined) {
    return fallback ?? "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback ?? "";
}

function resolveServiceAccountField(value: string | undefined, fallback: string | undefined): string {
  if (value === undefined) {
    return fallback ?? "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback ?? "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidSearchConsoleProperty(value: string): boolean {
  if (value.startsWith("sc-domain:")) {
    return value.slice("sc-domain:".length).trim().length > 0;
  }
  return isHttpUrl(value);
}

function formatValidationError(error: z.ZodError): string {
  const messages = Array.from(new Set(error.issues.map((issue) => issue.message).filter(Boolean)));
  return messages[0] || "Invalid settings";
}
