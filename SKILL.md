---
name: emdash-analytics-plugin
description: Maintain the YourBright EmDash analytics plugin. Use when updating plugin settings UX, Google sync logic, agent API auth, or deployment/operations docs for `emdash-analytics-plugin`. Also use when staging or production blog deploys need this plugin's latest local changes.
---

# EmDash Analytics Plugin

This skill is for working on `/home/gurujowa/vscode/yourbright/emdash-analytics-plugin`.

## Scope

Use this skill when the task involves:

- plugin admin UI under `src/admin.tsx`
- plugin routes and auth under `src/index.ts`
- Google config validation and storage under `src/config*.ts`
- analytics sync and agent keys under `src/sync.ts`
- plugin documentation and operational notes

Do not use it for general EmDash core auth/scope changes unless the task explicitly expands into the `emdash` dependency itself.

## Important Constraints

- The plugin's public agent endpoints use plugin-scoped tokens with prefix `yb_ins_`.
- Do not use `Authorization: Bearer yb_ins_...` on those endpoints; EmDash core intercepts Bearer auth first. Use `Authorization: AgentKey ...` or `X-Emdash-Agent-Key`.
- EmDash core PAT/OAuth scopes do not currently substitute for those public plugin endpoints.
- Stored Google credentials require `EMDASH_AUTH_SECRET` in the runtime environment.
- In this repo, `landing-page/apps/blog-site` should consume the plugin from the published npm package. Local plugin edits are not automatically included in a normal deploy until a new package version is published and installed.

## Repo Pointers

- Plugin package: `emdash-analytics-plugin/`
- Host integration: `landing-page/apps/blog-site/astro.config.mjs`
- Blog dependency pin: `landing-page/apps/blog-site/package.json`
- Blog deploy scripts: `landing-page/package.json`

## Working Rules

1. Run plugin-local checks before closing work:
   `npm test`
   `npm run typecheck`
2. If the task affects staging or production runtime behavior, verify `EMDASH_AUTH_SECRET` exists for the target worker.
3. If a blog deploy must include unpublished local plugin edits, temporarily override the blog app's installed plugin package. A plain deploy from `landing-page` will otherwise use the installed npm version.
4. Keep README user-facing. Put operator or agent-maintenance guidance here in `SKILL.md`.

## Staging / Production Ops

Check worker secrets:

```bash
cd /home/gurujowa/vscode/yourbright/landing-page/apps/blog-site
bunx wrangler secret list --config wrangler.staging.jsonc
bunx wrangler secret list --config wrangler.jsonc
```

Set the required secret:

```bash
cd /home/gurujowa/vscode/yourbright/landing-page/apps/blog-site
openssl rand -hex 32 | bunx wrangler secret put EMDASH_AUTH_SECRET --config wrangler.staging.jsonc
openssl rand -hex 32 | bunx wrangler secret put EMDASH_AUTH_SECRET --config wrangler.jsonc
```

Deploy commands:

```bash
cd /home/gurujowa/vscode/yourbright/landing-page
bun run deploy:blog:staging
bun run deploy:blog
```

## Typical Tasks

- Fix `Save Settings` validation or encryption failures
- Adjust how empty settings fields merge with saved config
- Change plugin-scoped API key behavior or docs
- Update README after auth or deploy behavior changes
- Re-deploy blog staging with the latest local plugin changes
