# EmDash Analytics Plugin

Google Search Console and GA4 analytics plugin for EmDash.

This plugin provides:

- site-wide analytics sync for public pages
- opportunity scoring for managed content
- admin dashboard pages and widgets inside EmDash
- read-only agent endpoints protected by plugin-scoped API keys

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
    "@yourbright/emdash-analytics-plugin": "0.1.1"
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

This means:

- EmDash admin/private plugin routes use EmDash auth
- public analytics agent routes use plugin-scoped tokens

## Agent API

Public read-only endpoints:

- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/site-summary`
- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/opportunities?limit=50`
- `GET /_emdash/api/plugins/emdash-google-analytics-dashboard/agent/v1/content-context?collection=posts&id=<id>`

Send either:

```http
Authorization: AgentKey yb_ins_...
```

or:

```http
X-Emdash-Agent-Key: yb_ins_...
```

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

Initial implementation for YourBright. The package metadata is ready for public npm release, but npm credentials still need to be configured on this machine before publish.
