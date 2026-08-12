# EmDash Analytics Plugin

Google Search Console and GA4 analytics plugin for EmDash.

This plugin provides:

- site-wide analytics sync for public pages
- opportunity scoring for managed content
- a D1-backed SEO/content improvement action ledger
- admin dashboard pages and widgets inside EmDash
- scoped agent endpoints protected by plugin-specific API keys

## What It Adds

The plugin registers:

- admin pages: `Overview`, `Pages`, `Analytics`
- one dashboard widget: `Content Opportunities`
- background sync jobs for base metrics and managed query enrichment
- public agent endpoints under `agent/v1/*`

The plugin reads Google Search Console and GA4 data with a Google service account, stores aggregated page metrics in plugin storage, and exposes the scored results in the EmDash admin.

## Install

Install from npm:

```json
{
  "dependencies": {
    "@yourbright/emdash-analytics-plugin": "^0.3.0"
  }
}
```

Then register it in your EmDash integration:

```ts
import { contentInsightsPlugin } from "@yourbright/emdash-analytics-plugin";

emdash({
  database,
  storage,
  plugins: [contentInsightsPlugin()],
});
```

## Runtime Requirements

This plugin needs:

- EmDash plugin capabilities: `network:fetch`, `read:content`
- outbound access to:
  - `oauth2.googleapis.com`
  - `analyticsdata.googleapis.com`
  - `www.googleapis.com`
- a worker/runtime secret named `EMDASH_AUTH_SECRET`

`EMDASH_AUTH_SECRET` is required because the plugin encrypts the stored Google service account credential before saving it. Without that secret, `Save Settings` fails at runtime.

Examples:

```bash
bunx wrangler secret put EMDASH_AUTH_SECRET --config wrangler.staging.jsonc
bunx wrangler secret put EMDASH_AUTH_SECRET --config wrangler.jsonc
```

Use a different secret per environment unless you intentionally need encrypted settings to be portable across environments.

## Admin Setup

Open the plugin settings page in EmDash and configure:

- `Canonical Site Origin`
- `GA4 Property ID`
- `Search Console Property`
- `Service Account JSON`

Notes:

- `Service Account JSON` is required on the first save.
- After the first successful save, leaving `Service Account JSON` blank keeps the currently stored credential.
- If non-secret fields are left blank during an update, the plugin keeps the previously saved values.

After saving:

1. Run `Test Connection`
2. Run `Run Manual Sync`
3. Check `Overview` and `Pages`

## Authentication Model

This plugin intentionally uses its own API keys for `agent/v1/*`.

- Plugin keys are created in the Analytics settings page
- Raw tokens use the prefix `yb_ins_`
- They are independent from EmDash core PAT/OAuth tokens
- Existing keys and new `Read only` keys have `analytics:read`
- `Read + action write` keys have both `analytics:read` and `content-insights:write`
- `Read + analytics sync` keys have both `analytics:read` and `analytics:sync`
- `Full automation` keys have all three scopes

This means:

- EmDash admin/private plugin routes use EmDash auth
- public analytics agent routes require `analytics:read`
- analytics refresh requests require a separately generated key with `analytics:sync`
- action mutations require a separately generated key with `content-insights:write`

Keys created before scoped keys were introduced remain valid and are treated as read-only. Create a
new purpose-scoped key in `Analytics > Settings > Agent API Keys`; do not reuse a general analytics
reader for Codex Automation mutations. `analytics:sync` does not grant EmDash admin access and does
not permit content-insight action writes.

## Agent API

Public read endpoints:

- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/site-summary`
- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/opportunities?limit=50`
- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/content-context?collection=posts&id=<id>`
- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions?status=measuring`
- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions?id=<action-id>`

Analytics sync endpoints:

- `POST /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/sync`
- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/sync?id=<run-id>`

Action write endpoints:

- `POST /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions`
- `POST /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions/link-revision`
- `POST /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions/measurements`
- `POST /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions/status`

EmDash plugin routes use fixed route names, so the action ID is supplied as a query parameter for
reads and in the JSON body for writes instead of a dynamic `/:id` path segment.

Send either:

```http
Authorization: AgentKey yb_ins_...
```

or:

```http
X-Emdash-Agent-Key: yb_ins_...
```

Every write also requires an `Idempotency-Key` header between 8 and 200 characters. Reuse the same
key only when retrying the exact same mutation. Reusing it with a different body returns `409`.

## Analytics Sync Workflow

Use a dedicated key with `analytics:read` and `analytics:sync`. The admin-only
`admin/sync-now` route remains unchanged and is not available to agent keys.

### 1. Queue a sync

```bash
curl --request POST \
  --header "Authorization: AgentKey $EMDASH_ANALYTICS_SYNC_KEY" \
  --header "Idempotency-Key: analytics-sync-2026-08-12" \
  "$SITE_ORIGIN/_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/sync"
```

The response includes an `asr_...` run ID, a `queued`, `running`, or `retrying` status, and a
recommended polling delay. EmDash plugin routes currently wrap accepted work in an HTTP `200`
response, so callers must inspect `data.accepted` and `data.run.status` rather than treating the
HTTP status alone as completion.

The plugin persists the run before scheduling a durable one-shot cron task. The task refreshes the
freshness-bearing base GSC/GA4 data, retries up to five times with exponential backoff, and marks the
run `success` or `error`. Managed-query enrichment remains on its separate scheduled job so an agent
sync stays within the platform task lease. The agent path updates page aggregates, site summary, and
freshness but leaves daily trend persistence to the existing recurring base-sync job. Only one sync
may be open at a time. A successful run also
starts a 15-minute cooldown. Repeating the same `Idempotency-Key` returns the original run without
starting duplicate work.

### 2. Poll the run

```bash
curl \
  --header "Authorization: AgentKey $EMDASH_ANALYTICS_SYNC_KEY" \
  "$SITE_ORIGIN/_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/sync?id=asr_..."
```

Treat only `success` as a completed refresh. `queued`, `running`, and `retrying` remain open;
`error` is terminal. Freshness metadata is updated by the existing base sync only after its data
writes succeed.

## Content Improvement Workflow

The action ledger records coordination and measurement data in EmDash plugin storage, which is
backed by the host database (D1 in the YourBright deployment). It does not write directly to EmDash
content or revision tables. Article edits and draft revisions continue to use the EmDash Content
API.

One open action (`planned`, `applied`, or `measuring`) is allowed per content item. This prevents a
daily automation from changing a page again while an earlier change is still being measured.

### 1. Create a planned action

```bash
curl --request POST \
  --header "Authorization: AgentKey $EMDASH_INSIGHTS_WRITE_KEY" \
  --header "Idempotency-Key: ctr-post-123-2026-07-21-plan" \
  --header "Content-Type: application/json" \
  --data '{
    "contentCollection": "posts",
    "contentId": "post-123",
    "contentSlug": "example-post",
    "urlPath": "/blog/example-post/",
    "targetQuery": "example query",
    "reason": "High impressions and low CTR",
    "hypothesis": "A clearer title will better match search intent",
    "changeSummary": "Rewrite the title and SEO description",
    "baselinePeriod": { "startDate": "2026-06-01", "endDate": "2026-06-28" },
    "measurementPeriod": { "startDate": "2026-07-22", "endDate": "2026-08-18" },
    "detectedAt": "2026-07-21T00:00:00.000Z"
  }' \
  "$SITE_ORIGIN/_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions"
```

Store the returned `action.id`. Next, create the draft revision through the EmDash Content API. If
that operation fails, leave the action as `planned` or mark it `failed`; do not report the change as
applied.

### 2. Link the EmDash revision

```bash
curl --request POST \
  --header "Authorization: AgentKey $EMDASH_INSIGHTS_WRITE_KEY" \
  --header "Idempotency-Key: ctr-post-123-2026-07-21-link" \
  --header "Content-Type: application/json" \
  --data '{ "actionId": "cia_...", "revisionId": "revision-..." }' \
  "$SITE_ORIGIN/_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions/link-revision"
```

An action cannot transition to `applied` until a revision is linked.

### 3. Advance the action status

```bash
curl --request POST \
  --header "Authorization: AgentKey $EMDASH_INSIGHTS_WRITE_KEY" \
  --header "Idempotency-Key: ctr-post-123-2026-07-21-applied" \
  --header "Content-Type: application/json" \
  --data '{ "actionId": "cia_...", "status": "applied" }' \
  "$SITE_ORIGIN/_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions/status"
```

Supported lifecycle:

```text
planned -> applied -> measuring -> improved | neutral | regressed
planned | applied | measuring -> failed
applied | measuring | regressed -> rolled_back
```

### 4. Record GSC measurements

```bash
curl --request POST \
  --header "Authorization: AgentKey $EMDASH_INSIGHTS_WRITE_KEY" \
  --header "Idempotency-Key: ctr-post-123-baseline-2026-06-28" \
  --header "Content-Type: application/json" \
  --data '{
    "actionId": "cia_...",
    "phase": "baseline",
    "periodStart": "2026-06-01",
    "periodEnd": "2026-06-28",
    "clicks": 40,
    "impressions": 1000,
    "position": 6.2
  }' \
  "$SITE_ORIGIN/_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/actions/measurements"
```

Record a second measurement with `phase: "post_change"` after the measurement window. CTR is
calculated by the plugin from clicks and impressions. Both phases are required before setting an
evaluation status (`improved`, `neutral`, or `regressed`). The API records append-only action events
for creation, revision linking, measurements, and status changes.

## Development

From this package directory:

```bash
npm test
npm run typecheck
```

## YourBright Integration Notes

In this repo, the plugin is consumed from `landing-page/apps/blog-site/astro.config.mjs`.

Operational details for this repo:

- the blog app should depend on the published npm version of this plugin
- local plugin edits are not picked up by a normal blog deploy unless the dependency ref is updated or the package is locally overridden during build
- staging and production workers both need `EMDASH_AUTH_SECRET`

Blog deploy commands live in `landing-page/package.json`:

```bash
bun run deploy:blog:staging
bun run deploy:blog
```

## Status

Published releases use npm Trusted Publishing from the repository's `release.yml` GitHub Actions workflow. The workflow is started manually and authenticates with short-lived OIDC credentials; no long-lived npm publish token is required.
