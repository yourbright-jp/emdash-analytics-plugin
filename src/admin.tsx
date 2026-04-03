import type { PluginAdminExports } from "emdash";
import { apiFetch as baseFetch, getErrorMessage, parseApiResponse } from "emdash/plugin-utils";
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

const EMPTY_CONFIG: ConfigDraft = {
  siteOrigin: "",
  ga4PropertyId: "",
  gscSiteUrl: "",
  serviceAccountJson: ""
};

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
      ? "bg-foreground text-background hover:opacity-90"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-700"
        : "border border-border bg-background text-foreground hover:bg-accent";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
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
            <th className="pb-3 pr-4">ページ</th>
            <th className="pb-3 pr-4">種別</th>
            <th className="pb-3 pr-4">GSC Clicks</th>
            <th className="pb-3 pr-4">GA Views</th>
            <th className="pb-3 pr-4">改善スコア</th>
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
        parseApiResponse<StatusResponse>(statusRes, "状態を取得できませんでした"),
        parseApiResponse<OverviewResponse>(overviewRes, "概要を取得できませんでした")
      ]);
      setStatus(statusData);
      setOverview(overviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "概要を取得できませんでした");
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
      title="コンテンツ改善インサイト"
      description="Search Console と GA4 の統合データから、改善余地の大きいページを優先表示します。"
      actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>再読み込み</Button>}
    >
      <ErrorBanner message={error} />
      {!status?.config ? (
        <Section title="未設定" subtitle="最初に Settings で Google 接続情報を保存してください。">
          <div className="text-sm text-muted-foreground">
            設定保存後に手動同期を実行すると、この画面に集計が表示されます。
          </div>
        </Section>
      ) : null}
      <Section title="最新状態" subtitle="同期の鮮度とデータソースの更新日です。">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Last Sync" value={formatDateTime(freshness.lastSyncedAt)} note={statusLabel(freshness.lastStatus)} />
          <StatCard label="GSC Final Date" value={freshness.lastGscDate || "-"} />
          <StatCard label="GA Final Date" value={freshness.lastGaDate || "-"} />
          <StatCard label="Service Account" value={status?.config?.serviceAccountEmail || "-"} />
        </div>
      </Section>
      <Section title="全体KPI" subtitle="直近 28 日の公開ページ合計です。">
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
        <Section title="改善候補トップ5" subtitle="管理対象コンテンツのみです。">
          <MetricTable items={overview?.topOpportunities ?? []} emptyMessage="改善候補はまだありません。" />
        </Section>
        <Section title="未管理ページの上位流入" subtitle="公開ページ全体のうち EmDash 管理外のページです。">
          <MetricTable items={overview?.topUnmanaged ?? []} emptyMessage="未管理ページのデータはまだありません。" />
        </Section>
      </div>
      <Section title="集計期間" subtitle="API 返却でも同じ window を返します。">
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
      const data = await parseApiResponse<PageListResponse>(response, "ページ一覧を取得できませんでした");
      setPages(data.items);
      if (selected) {
        const nextSelected = data.items.find((item) => item.urlPath === selected.urlPath) || null;
        setSelected(nextSelected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "ページ一覧を取得できませんでした");
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
        const data = await parseApiResponse<Record<string, unknown>>(response, "詳細を取得できませんでした");
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
    <Shell title="ページ一覧" description="公開ページ全体を見ながら、managed / unmanaged を切り替えて改善対象を絞り込みます。">
      <ErrorBanner message={error} />
      <Section title="フィルタ">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="対象">
            <Select
              value={managed}
              onChange={(value) => setManaged(value as typeof managed)}
              options={[
                { value: "all", label: "すべて" },
                { value: "managed", label: "EmDash 管理のみ" },
                { value: "unmanaged", label: "EmDash 管理外のみ" }
              ]}
            />
          </Field>
          <Field label="ページ種別">
            <Select
              value={pageKind}
              onChange={(value) => setPageKind(value as typeof pageKind)}
              options={[
                { value: "all", label: "すべて" },
                { value: "blog_post", label: "ブログ記事" },
                { value: "blog_archive", label: "ブログ一覧" },
                { value: "tag", label: "タグ" },
                { value: "author", label: "著者" },
                { value: "landing", label: "公開ページ" },
                { value: "other", label: "その他" }
              ]}
            />
          </Field>
          <Field label="改善候補のみ">
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
              絞り込みを更新
            </Button>
          </div>
        </div>
      </Section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <Section title="ページテーブル" subtitle={loading ? "読み込み中です。" : `${pages.length} 件を表示しています。`}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-4">ページ</th>
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
        <Section title="選択中のページ" subtitle="managed ページを選ぶと query と opportunity evidence も表示します。">
          {!selected ? (
            <div className="text-sm text-muted-foreground">左の表からページを選択してください。</div>
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
                    <span className="text-sm text-muted-foreground">タグはありません。</span>
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
        parseApiResponse<PluginConfigSummary>(configRes, "設定を取得できませんでした"),
        parseApiResponse<AgentKeyListItem[]>(keysRes, "API key 一覧を取得できませんでした")
      ]);
      setDraft({
        siteOrigin: config.siteOrigin || "",
        ga4PropertyId: config.ga4PropertyId || "",
        gscSiteUrl: config.gscSiteUrl || "",
        serviceAccountJson: ""
      });
      setKeys(agentKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定を取得できませんでした");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy("save");
    setError(null);
    setSuccess(null);
    try {
      const response = await apiPost<PluginConfigSummary>(ADMIN_ROUTES.CONFIG_SAVE, draft);
      await parseApiResponse<PluginConfigSummary>(response, "設定を保存できませんでした");
      setDraft((current) => ({ ...current, serviceAccountJson: "" }));
      setSuccess("接続設定を保存しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定を保存できませんでした");
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async () => {
    setBusy("test");
    setError(null);
    setSuccess(null);
    try {
      const payload = draft.serviceAccountJson.trim()
        ? draft
        : {
            siteOrigin: draft.siteOrigin,
            ga4PropertyId: draft.ga4PropertyId,
            gscSiteUrl: draft.gscSiteUrl
          };
      const response = await apiPost<Record<string, unknown>>(ADMIN_ROUTES.CONNECTION_TEST, payload);
      await parseApiResponse<Record<string, unknown>>(response, "接続テストに失敗しました");
      setSuccess("Google Search Console / GA4 への接続に成功しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "接続テストに失敗しました");
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
      await parseApiResponse<Record<string, unknown>>(response, "手動同期に失敗しました");
      setSuccess("同期を開始しました。完了後に Overview を再読み込みしてください。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "手動同期に失敗しました");
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
      const data = await parseApiResponse<AgentKeyCreateResponse>(response, "API key を作成できませんでした");
      setGeneratedKey(data.key);
      setNewKeyLabel("");
      setSuccess("新しい Agent API key を作成しました。表示は今回限りです。");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "API key を作成できませんでした");
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
      await parseApiResponse<{ success: true }>(response, "API key を失効できませんでした");
      setSuccess(`${prefix} を失効しました。`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "API key を失効できませんでした");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell
      title="設定"
      description="Google 接続情報の保存、手動同期、agent 向け API key 管理を行います。"
      actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>再読み込み</Button>}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <Section title="Google 接続">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Canonical Site Origin" hint="例: https://www.yourbright.co.jp">
            <Input value={draft.siteOrigin} onChange={(value) => setDraft((current) => ({ ...current, siteOrigin: value }))} />
          </Field>
          <Field label="GA4 Property ID" hint="数値の property ID を入力します。">
            <Input value={draft.ga4PropertyId} onChange={(value) => setDraft((current) => ({ ...current, ga4PropertyId: value }))} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Search Console Property" hint="例: https://www.yourbright.co.jp/ または sc-domain:yourbright.co.jp">
              <Input value={draft.gscSiteUrl} onChange={(value) => setDraft((current) => ({ ...current, gscSiteUrl: value }))} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Service Account JSON" hint="保存時には暗号化します。既存 secret を維持したい場合は空のままにしてください。">
              <TextArea
                value={draft.serviceAccountJson}
                onChange={(value) => setDraft((current) => ({ ...current, serviceAccountJson: value }))}
                placeholder='{"client_email":"...","private_key":"..."}'
                rows={12}
              />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={!!busy}>
            {busy === "save" ? "保存中..." : "保存"}
          </Button>
          <Button variant="secondary" onClick={() => void testConnection()} disabled={!!busy}>
            {busy === "test" ? "テスト中..." : "接続テスト"}
          </Button>
          <Button variant="secondary" onClick={() => void syncNow()} disabled={!!busy}>
            {busy === "sync" ? "同期中..." : "手動同期"}
          </Button>
        </div>
      </Section>
      <Section title="Agent API Key" subtitle="Bearer yb_ins_... 形式で利用します。raw key は作成時に一度だけ表示されます。">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="新しい key のラベル">
            <Input value={newKeyLabel} onChange={setNewKeyLabel} placeholder="content-feedback-agent" />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => void createKey()} disabled={!!busy || !newKeyLabel.trim()}>
              {busy === "create-key" ? "作成中..." : "Key を作成"}
            </Button>
          </div>
        </div>
        {generatedKey ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-medium text-amber-900">作成済みキー</div>
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
                        失効
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
        const data = await parseApiResponse<OverviewResponse>(response, "Widget data を取得できませんでした");
        if (!cancelled) setOverview(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Widget data を取得できませんでした");
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
      <MetricTable items={overview?.topOpportunities ?? []} emptyMessage="改善候補はまだありません。" />
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
          <div className="text-sm text-muted-foreground">Opportunity evidence はまだありません。</div>
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
          <div className="text-sm text-muted-foreground">query データはまだありません。</div>
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
      return "ブログ記事";
    case "blog_archive":
      return "ブログ一覧";
    case "tag":
      return "タグ";
    case "author":
      return "著者";
    case "landing":
      return "公開ページ";
    default:
      return "その他";
  }
}

function statusLabel(status: FreshnessState["lastStatus"]): string {
  switch (status) {
    case "success":
      return "正常";
    case "degraded":
      return "一部失敗";
    case "error":
      return "失敗";
    default:
      return "未実行";
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
