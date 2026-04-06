import type { PluginAdminExports } from "emdash";
import { apiFetch as baseFetch, parseApiResponse } from "emdash/plugin-utils";
import * as React from "react";

import { ADMIN_ROUTES, PLUGIN_ID } from "./constants.js";
import type {
  AgentKeyRecord,
  FreshnessState,
  PageAggregateRecord,
  PageKind,
  PageListResponse,
  PluginConfigSummary,
  SiteSummary
} from "./types.js";

const API_BASE = `/_emdash/api/plugins/${PLUGIN_ID}`;

interface StatusResponse {
  config: PluginConfigSummary | null;
  summary: SiteSummary | null;
  freshness: FreshnessState;
}

interface OverviewResponse {
  summary: SiteSummary | null;
  freshness: FreshnessState;
  topOpportunities: PageAggregateRecord[];
  topUnmanaged: PageAggregateRecord[];
}

interface AgentKeyListItem extends Omit<AgentKeyRecord, "hash"> {}

interface AgentKeyCreateResponse {
  key: string;
  metadata: AgentKeyListItem;
}

interface ConfigDraft {
  siteOrigin: string;
  ga4PropertyId: string;
  gscSiteUrl: string;
  serviceAccountJson: string;
}

interface StoredConfigFields {
  siteOrigin: string;
  ga4PropertyId: string;
  gscSiteUrl: string;
}

const EMPTY_CONFIG: ConfigDraft = {
  siteOrigin: "",
  ga4PropertyId: "",
  gscSiteUrl: "",
  serviceAccountJson: ""
};

function validateSettingsDraft(
  draft: ConfigDraft,
  stored: StoredConfigFields,
  hasStoredServiceAccount: boolean
): string | null {
  const siteOrigin = resolveDraftField(draft.siteOrigin, stored.siteOrigin);
  const ga4PropertyId = resolveDraftField(draft.ga4PropertyId, stored.ga4PropertyId);
  const gscSiteUrl = resolveDraftField(draft.gscSiteUrl, stored.gscSiteUrl);
  const serviceAccountJson = draft.serviceAccountJson.trim();

  if (!siteOrigin) return "Canonical Site Origin is required";
  if (!isHttpUrl(siteOrigin)) return "Canonical Site Origin must be a valid http(s) URL";
  if (!ga4PropertyId) return "GA4 Property ID is required";
  if (!/^[0-9]+$/.test(ga4PropertyId)) return "GA4 Property ID must be numeric";
  if (!gscSiteUrl) return "Search Console Property is required";
  if (!isValidSearchConsoleProperty(gscSiteUrl)) {
    return "Search Console Property must be a valid URL or sc-domain property";
  }
  if (!serviceAccountJson && !hasStoredServiceAccount) {
    return "Service Account JSON is required on the first save";
  }
  if (serviceAccountJson) {
    const serviceAccountError = validateServiceAccountJson(serviceAccountJson);
    if (serviceAccountError) return serviceAccountError;
  }
  return null;
}

function resolveDraftField(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback.trim();
}

function validateServiceAccountJson(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const clientEmail = typeof parsed.client_email === "string" ? parsed.client_email.trim() : "";
    const privateKey = typeof parsed.private_key === "string" ? parsed.private_key.trim() : "";
    if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      return "Service Account JSON must include a valid client_email";
    }
    if (!privateKey) {
      return "Service Account JSON must include a private_key";
    }
    return null;
  } catch {
    return "Service Account JSON must be valid JSON";
  }
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

function apiPost<T>(route: string, body?: unknown): Promise<Response> {
  return baseFetch(`${API_BASE}/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
}

function apiGet<T>(route: string): Promise<Response> {
  return baseFetch(`${API_BASE}/${route}`);
}

function buildConfigPayload(draft: ConfigDraft): {
  siteOrigin: string;
  ga4PropertyId: string;
  gscSiteUrl: string;
  serviceAccountJson?: string;
} {
  const payload = {
    siteOrigin: draft.siteOrigin.trim(),
    ga4PropertyId: draft.ga4PropertyId.trim(),
    gscSiteUrl: draft.gscSiteUrl.trim()
  };
  const serviceAccountJson = draft.serviceAccountJson.trim();

  if (!serviceAccountJson) {
    return payload;
  }

  return {
    ...payload,
    serviceAccountJson
  };
}

function Shell({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  note
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {message}
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button"
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
}) {
  const styles =
    variant === "primary"
      ? "border text-white shadow-sm"
      : variant === "danger"
        ? "border text-white shadow-sm"
        : "border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-50";
  const style =
    variant === "primary"
      ? {
          backgroundColor: "var(--color-kumo-brand)",
          borderColor: "var(--color-kumo-brand)"
        }
      : variant === "danger"
        ? {
            backgroundColor: "var(--color-kumo-danger)",
            borderColor: "var(--color-kumo-danger)"
          }
        : undefined;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground"
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 8
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground"
    />
  );
}

function Select({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {children}
    </label>
  );
}

function MetricTable({
  items,
  emptyMessage
}: {
  items: PageAggregateRecord[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
          <tr>
            <th className="pb-3 pr-4">Page</th>
            <th className="pb-3 pr-4">Type</th>
            <th className="pb-3 pr-4">GSC Clicks</th>
            <th className="pb-3 pr-4">GA Views</th>
            <th className="pb-3 pr-4">Opportunity Score</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.urlPath} className="border-t border-border/80">
              <td className="py-3 pr-4">
                <div className="font-medium">{item.title}</div>
                <div className="text-xs text-muted-foreground">{item.urlPath}</div>
              </td>
              <td className="py-3 pr-4">{pageKindLabel(item.pageKind)}</td>
              <td className="py-3 pr-4">{formatInteger(item.gscClicks28d)}</td>
              <td className="py-3 pr-4">{formatInteger(item.gaViews28d)}</td>
              <td className="py-3 pr-4">
                <span className="rounded-full bg-accent px-2 py-1 text-xs font-medium">
                  {item.opportunityScore}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverviewPage() {
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [overview, setOverview] = React.useState<OverviewResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, overviewRes] = await Promise.all([
        apiGet(ADMIN_ROUTES.STATUS),
        apiGet(ADMIN_ROUTES.OVERVIEW)
      ]);
      const [statusData, overviewData] = await Promise.all([
        parseApiResponse<StatusResponse>(statusRes, "Failed to load status"),
        parseApiResponse<OverviewResponse>(overviewRes, "Failed to load overview")
      ]);
      setStatus(statusData);
      setOverview(overviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const summary = overview?.summary ?? status?.summary ?? null;
  const freshness = overview?.freshness ?? status?.freshness ?? idleFreshness();

  return (
    <Shell
      title="Content Insights"
      description="Prioritize pages with the clearest opportunities using combined Search Console and GA4 data."
      actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>Reload</Button>}
    >
      <ErrorBanner message={error} />
      {!status?.config ? (
        <Section title="Not Configured" subtitle="Save your Google connection settings first.">
          <div className="text-sm text-muted-foreground">
            After saving the configuration, run a manual sync to populate this dashboard.
          </div>
        </Section>
      ) : null}
      <Section title="Freshness" subtitle="Track the latest sync and the effective source dates.">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Last Sync" value={formatDateTime(freshness.lastSyncedAt)} note={statusLabel(freshness.lastStatus)} />
          <StatCard label="GSC Final Date" value={freshness.lastGscDate || "-"} />
          <StatCard label="GA Final Date" value={freshness.lastGaDate || "-"} />
          <StatCard label="Service Account" value={status?.config?.serviceAccountEmail || "-"} />
        </div>
      </Section>
      <Section title="KPI Snapshot" subtitle="Aggregated totals for the last 28 days across public pages.">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="GSC Clicks" value={formatInteger(summary?.totals.gscClicks28d ?? 0)} />
          <StatCard label="GSC Impressions" value={formatInteger(summary?.totals.gscImpressions28d ?? 0)} />
          <StatCard label="GA Views" value={formatInteger(summary?.totals.gaViews28d ?? 0)} />
          <StatCard label="GA Users" value={formatInteger(summary?.totals.gaUsers28d ?? 0)} />
          <StatCard label="GA Sessions" value={formatInteger(summary?.totals.gaSessions28d ?? 0)} />
          <StatCard label="Managed Opportunities" value={formatInteger(summary?.totals.managedOpportunities ?? 0)} />
        </div>
      </Section>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Top Opportunities" subtitle="Managed content only.">
          <MetricTable items={overview?.topOpportunities ?? []} emptyMessage="No opportunities yet." />
        </Section>
        <Section title="Top Unmanaged Pages" subtitle="Public pages outside EmDash-managed content.">
          <MetricTable items={overview?.topUnmanaged ?? []} emptyMessage="No unmanaged page data yet." />
        </Section>
      </div>
      <Section title="Reporting Windows" subtitle="The agent API returns the same windows.">
        <div className="grid gap-4 md:grid-cols-2">
          <WindowCard label="GSC Current" value={summary?.window.gscCurrent} />
          <WindowCard label="GSC Previous" value={summary?.window.gscPrevious} />
          <WindowCard label="GA Current" value={summary?.window.gaCurrent} />
          <WindowCard label="GA Previous" value={summary?.window.gaPrevious} />
        </div>
      </Section>
    </Shell>
  );
}

function PagesPage() {
  const [managed, setManaged] = React.useState<"all" | "managed" | "unmanaged">("all");
  const [pageKind, setPageKind] = React.useState<"all" | PageKind>("all");
  const [hasOpportunity, setHasOpportunity] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pages, setPages] = React.useState<PageAggregateRecord[]>([]);
  const [selected, setSelected] = React.useState<PageAggregateRecord | null>(null);
  const [detail, setDetail] = React.useState<Record<string, unknown> | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiPost<PageListResponse>(ADMIN_ROUTES.LIST_PAGES, {
        managed,
        pageKind,
        hasOpportunity,
        limit: 100
      });
      const data = await parseApiResponse<PageListResponse>(response, "Failed to load page list");
      setPages(data.items);
      if (selected) {
        const nextSelected = data.items.find((item) => item.urlPath === selected.urlPath) || null;
        setSelected(nextSelected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load page list");
    } finally {
      setLoading(false);
    }
  }, [managed, pageKind, hasOpportunity, selected]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!selected?.contentId || selected.contentCollection !== "posts") {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await apiPost<Record<string, unknown>>(ADMIN_ROUTES.CONTENT_CONTEXT, {
          collection: selected.contentCollection,
          id: selected.contentId
        });
        const data = await parseApiResponse<Record<string, unknown>>(response, "Failed to load details");
        if (!cancelled) setDetail(data);
      } catch {
        if (!cancelled) setDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <Shell title="Pages" description="Explore all public pages and filter down to the content that needs attention.">
      <ErrorBanner message={error} />
      <Section title="Filters">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Scope">
            <Select
              value={managed}
              onChange={(value) => setManaged(value as typeof managed)}
              options={[
                { value: "all", label: "All Pages" },
                { value: "managed", label: "Managed Only" },
                { value: "unmanaged", label: "Unmanaged Only" }
              ]}
            />
          </Field>
          <Field label="Page Type">
            <Select
              value={pageKind}
              onChange={(value) => setPageKind(value as typeof pageKind)}
              options={[
                { value: "all", label: "All Types" },
                { value: "blog_post", label: "Blog Post" },
                { value: "blog_archive", label: "Blog Archive" },
                { value: "tag", label: "Tag" },
                { value: "author", label: "Author" },
                { value: "landing", label: "Landing" },
                { value: "other", label: "Other" }
              ]}
            />
          </Field>
          <Field label="Opportunities Only">
            <div className="flex h-10 items-center">
              <input
                type="checkbox"
                checked={hasOpportunity}
                onChange={(event) => setHasOpportunity(event.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
            </div>
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              Apply Filters
            </Button>
          </div>
        </div>
      </Section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <Section title="Page Table" subtitle={loading ? "Loading..." : `Showing ${pages.length} pages.`}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-4">Page</th>
                  <th className="pb-3 pr-4">Managed</th>
                  <th className="pb-3 pr-4">GSC CTR</th>
                  <th className="pb-3 pr-4">GA Views</th>
                  <th className="pb-3 pr-4">Score</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr
                    key={page.urlPath}
                    className={`cursor-pointer border-t border-border/80 transition hover:bg-accent/40 ${selected?.urlPath === page.urlPath ? "bg-accent/60" : ""}`}
                    onClick={() => setSelected(page)}
                  >
                    <td className="py-3 pr-4">
                      <div className="font-medium">{page.title}</div>
                      <div className="text-xs text-muted-foreground">{page.urlPath}</div>
                    </td>
                    <td className="py-3 pr-4">{page.managed ? "Yes" : "No"}</td>
                    <td className="py-3 pr-4">{formatPercent(page.gscCtr28d)}</td>
                    <td className="py-3 pr-4">{formatInteger(page.gaViews28d)}</td>
                    <td className="py-3 pr-4">{page.opportunityScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Selected Page" subtitle="Managed pages also show query data and opportunity evidence.">
          {!selected ? (
            <div className="text-sm text-muted-foreground">Select a page from the table.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold">{selected.title}</div>
                <div className="text-xs text-muted-foreground">{selected.urlPath}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard label="GSC Impressions" value={formatInteger(selected.gscImpressions28d)} />
                <StatCard label="GSC CTR" value={formatPercent(selected.gscCtr28d)} />
                <StatCard label="GA Views" value={formatInteger(selected.gaViews28d)} />
                <StatCard label="GA Engagement" value={formatPercent(selected.gaEngagementRate28d)} />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Opportunity Tags</div>
                <div className="flex flex-wrap gap-2">
                  {selected.opportunityTags.length > 0 ? (
                    selected.opportunityTags.map((tag) => (
                      <span key={tag} className="rounded-full bg-accent px-2 py-1 text-xs font-medium">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No tags.</span>
                  )}
                </div>
              </div>
              {detail ? <DetailBlock detail={detail} /> : null}
            </div>
          )}
        </Section>
      </div>
    </Shell>
  );
}

function SettingsPage() {
  const [draft, setDraft] = React.useState<ConfigDraft>(EMPTY_CONFIG);
  const [storedConfig, setStoredConfig] = React.useState<StoredConfigFields>({
    siteOrigin: "",
    ga4PropertyId: "",
    gscSiteUrl: ""
  });
  const [hasStoredServiceAccount, setHasStoredServiceAccount] = React.useState(false);
  const [storedServiceAccountEmail, setStoredServiceAccountEmail] = React.useState<string | null>(null);
  const [keys, setKeys] = React.useState<AgentKeyListItem[]>([]);
  const [newKeyLabel, setNewKeyLabel] = React.useState("");
  const [generatedKey, setGeneratedKey] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, keysRes] = await Promise.all([
        apiGet(ADMIN_ROUTES.CONFIG_GET),
        apiGet(ADMIN_ROUTES.AGENT_KEYS_LIST)
      ]);
      const [config, agentKeys] = await Promise.all([
        parseApiResponse<PluginConfigSummary>(configRes, "Failed to load settings"),
        parseApiResponse<AgentKeyListItem[]>(keysRes, "Failed to load API keys")
      ]);
      setDraft({
        siteOrigin: config.siteOrigin || "",
        ga4PropertyId: config.ga4PropertyId || "",
        gscSiteUrl: config.gscSiteUrl || "",
        serviceAccountJson: ""
      });
      setStoredConfig({
        siteOrigin: config.siteOrigin || "",
        ga4PropertyId: config.ga4PropertyId || "",
        gscSiteUrl: config.gscSiteUrl || ""
      });
      setHasStoredServiceAccount(!!config.hasServiceAccount);
      setStoredServiceAccountEmail(config.serviceAccountEmail || null);
      setKeys(agentKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const validationMessage = validateSettingsDraft(draft, storedConfig, hasStoredServiceAccount);
    if (validationMessage) {
      setError(validationMessage);
      setSuccess(null);
      return;
    }
    setBusy("save");
    setError(null);
    setSuccess(null);
    try {
      const payload = buildConfigPayload(draft);
      const config = await parseApiResponse<PluginConfigSummary>(
        await apiPost<PluginConfigSummary>(ADMIN_ROUTES.CONFIG_SAVE, payload),
        "Failed to save settings"
      );
      setDraft((current) => ({
        ...current,
        serviceAccountJson: ""
      }));
      setHasStoredServiceAccount(true);
      setStoredServiceAccountEmail(config.serviceAccountEmail || storedServiceAccountEmail);
      setStoredConfig({
        siteOrigin: config.siteOrigin || storedConfig.siteOrigin,
        ga4PropertyId: config.ga4PropertyId || storedConfig.ga4PropertyId,
        gscSiteUrl: config.gscSiteUrl || storedConfig.gscSiteUrl
      });
      setSuccess("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async () => {
    const validationMessage = validateSettingsDraft(draft, storedConfig, hasStoredServiceAccount);
    if (validationMessage) {
      setError(validationMessage);
      setSuccess(null);
      return;
    }
    setBusy("test");
    setError(null);
    setSuccess(null);
    try {
      const response = await apiPost<Record<string, unknown>>(ADMIN_ROUTES.CONNECTION_TEST, buildConfigPayload(draft));
      await parseApiResponse<Record<string, unknown>>(response, "Connection test failed");
      setSuccess("Connection test succeeded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy("sync");
    setError(null);
    setSuccess(null);
    try {
      const response = await apiPost<Record<string, unknown>>(ADMIN_ROUTES.SYNC_NOW);
      await parseApiResponse<Record<string, unknown>>(response, "Manual sync failed");
      setSuccess("Manual sync started. Reload Overview after it completes.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manual sync failed");
    } finally {
      setBusy(null);
    }
  };

  const createKey = async () => {
    if (!newKeyLabel.trim()) return;
    setBusy("create-key");
    setError(null);
    setSuccess(null);
    try {
      const response = await apiPost<AgentKeyCreateResponse>(ADMIN_ROUTES.AGENT_KEYS_CREATE, {
        label: newKeyLabel.trim()
      });
      const data = await parseApiResponse<AgentKeyCreateResponse>(response, "Failed to create API key");
      setGeneratedKey(data.key);
      setNewKeyLabel("");
      setSuccess("Created a new agent API key. This is the only time the raw key will be shown.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setBusy(null);
    }
  };

  const revokeKey = async (prefix: string) => {
    setBusy(prefix);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiPost<{ success: true }>(ADMIN_ROUTES.AGENT_KEYS_REVOKE, { prefix });
      await parseApiResponse<{ success: true }>(response, "Failed to revoke API key");
      setSuccess(`Revoked ${prefix}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell
      title="Analytics"
      description="Manage Google connection settings, manual sync, and agent API keys."
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <Section title="Google Connection">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Canonical Site Origin" hint="Example: https://www.yourbright.co.jp">
            <Input value={draft.siteOrigin} onChange={(value) => setDraft((current) => ({ ...current, siteOrigin: value }))} />
          </Field>
          <Field label="GA4 Property ID" hint="Enter the numeric property ID.">
            <Input value={draft.ga4PropertyId} onChange={(value) => setDraft((current) => ({ ...current, ga4PropertyId: value }))} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Search Console Property" hint="Example: https://www.yourbright.co.jp/ or sc-domain:yourbright.co.jp">
              <Input value={draft.gscSiteUrl} onChange={(value) => setDraft((current) => ({ ...current, gscSiteUrl: value }))} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field
              label="Service Account JSON"
              hint={
                hasStoredServiceAccount
                  ? `Current: ${storedServiceAccountEmail || "configured"}. Leave blank to keep the current secret.`
                  : "Required on the first save."
              }
            >
              <TextArea
                value={draft.serviceAccountJson}
                onChange={(value) => setDraft((current) => ({ ...current, serviceAccountJson: value }))}
                placeholder='{"client_email":"...","private_key":"..."}'
                rows={12}
              />
            </Field>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-4">
          <Button onClick={() => void save()} disabled={!!busy}>
            {busy === "save" ? "Saving..." : "Save Settings"}
          </Button>
          <Button variant="secondary" onClick={() => void testConnection()} disabled={!!busy}>
            {busy === "test" ? "Testing..." : "Test Connection"}
          </Button>
          <Button variant="secondary" onClick={() => void syncNow()} disabled={!!busy}>
            {busy === "sync" ? "Syncing..." : "Run Manual Sync"}
          </Button>
        </div>
      </Section>
      <Section title="Agent API Keys" subtitle="Use these as Bearer yb_ins_... tokens. Raw keys are shown only once.">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="New key label">
            <Input value={newKeyLabel} onChange={setNewKeyLabel} placeholder="content-feedback-agent" />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => void createKey()} disabled={!!busy || !newKeyLabel.trim()}>
              {busy === "create-key" ? "Creating..." : "Create Key"}
            </Button>
          </div>
        </div>
        {generatedKey ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-medium text-amber-900">Generated Key</div>
            <div className="mt-2 break-all font-mono text-sm text-amber-900">{generatedKey}</div>
          </div>
        ) : null}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="pb-3 pr-4">Prefix</th>
                <th className="pb-3 pr-4">Label</th>
                <th className="pb-3 pr-4">Created</th>
                <th className="pb-3 pr-4">Last Used</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.prefix} className="border-t border-border/80">
                  <td className="py-3 pr-4 font-mono text-xs">{key.prefix}</td>
                  <td className="py-3 pr-4">{key.label}</td>
                  <td className="py-3 pr-4">{formatDateTime(key.createdAt)}</td>
                  <td className="py-3 pr-4">{formatDateTime(key.lastUsedAt)}</td>
                  <td className="py-3 pr-4">{key.revokedAt ? "Revoked" : "Active"}</td>
                  <td className="py-3 pr-4">
                    {key.revokedAt ? null : (
                      <Button variant="danger" onClick={() => void revokeKey(key.prefix)} disabled={busy === key.prefix}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </Shell>
  );
}

function ContentOpportunitiesWidget() {
  const [overview, setOverview] = React.useState<OverviewResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiGet(ADMIN_ROUTES.OVERVIEW);
        const data = await parseApiResponse<OverviewResponse>(response, "Failed to load widget data");
        if (!cancelled) setOverview(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load widget data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <ErrorBanner message={error} />;
  }

  const summary = overview?.summary;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tracked Pages" value={formatInteger(summary?.totals.trackedPages ?? 0)} />
        <StatCard label="Managed Opportunities" value={formatInteger(summary?.totals.managedOpportunities ?? 0)} />
        <StatCard label="GSC Clicks" value={formatInteger(summary?.totals.gscClicks28d ?? 0)} />
        <StatCard label="GA Views" value={formatInteger(summary?.totals.gaViews28d ?? 0)} />
      </div>
      <MetricTable items={overview?.topOpportunities ?? []} emptyMessage="No opportunities yet." />
    </div>
  );
}

function DetailBlock({ detail }: { detail: Record<string, unknown> }) {
  const analytics = isRecord(detail.analytics) ? detail.analytics : null;
  const searchQueries = Array.isArray(analytics?.searchQueries) ? analytics.searchQueries : [];
  const opportunities = Array.isArray(analytics?.opportunities) ? analytics.opportunities : [];

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="space-y-2">
        <div className="text-sm font-medium">Opportunity Evidence</div>
        {opportunities.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {opportunities.map((entry, index) => {
              const row = isRecord(entry) ? entry : {};
              return (
                <li key={`${String(row.tag || index)}`} className="rounded-lg border border-border bg-background px-3 py-2">
                  <div className="font-medium">{String(row.tag || "-")}</div>
                  <div className="text-muted-foreground">{String(row.reason || "-")}</div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">No opportunity evidence yet.</div>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Top Search Queries</div>
        {searchQueries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-4">Query</th>
                  <th className="pb-3 pr-4">Clicks</th>
                  <th className="pb-3 pr-4">Impressions</th>
                  <th className="pb-3 pr-4">CTR</th>
                </tr>
              </thead>
              <tbody>
                {searchQueries.map((entry, index) => {
                  const row = isRecord(entry) ? entry : {};
                  return (
                    <tr key={`${String(row.query || index)}`} className="border-t border-border/80">
                      <td className="py-2 pr-4">{String(row.query || "-")}</td>
                      <td className="py-2 pr-4">{formatInteger(numberValue(row.clicks28d))}</td>
                      <td className="py-2 pr-4">{formatInteger(numberValue(row.impressions28d))}</td>
                      <td className="py-2 pr-4">{formatPercent(numberValue(row.ctr28d))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No query data yet.</div>
        )}
      </div>
    </div>
  );
}

function WindowCard({
  label,
  value
}: {
  label: string;
  value?: { startDate: string; endDate: string };
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-medium">
        {value ? `${value.startDate} - ${value.endDate}` : "-"}
      </div>
    </div>
  );
}

function formatInteger(value: number | null | undefined): string {
  return new Intl.NumberFormat("ja-JP").format(value ?? 0);
}

function formatPercent(value: number | null | undefined): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function pageKindLabel(pageKind: PageKind): string {
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

function statusLabel(status: FreshnessState["lastStatus"]): string {
  switch (status) {
    case "success":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "error":
      return "Failed";
    default:
      return "Idle";
  }
}

function idleFreshness(): FreshnessState {
  return {
    lastSyncedAt: null,
    lastGscDate: null,
    lastGaDate: null,
    lastStatus: "idle"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export const pages: PluginAdminExports["pages"] = {
  "/": OverviewPage,
  "/pages": PagesPage,
  "/settings": SettingsPage
};

export const widgets: PluginAdminExports["widgets"] = {
  "content-opportunities": ContentOpportunitiesWidget
};
