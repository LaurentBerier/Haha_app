# Repo and Vercel Topology

Last updated: **2026-04-04** (added DISABLE_IP_RATE_LIMIT note)

## Production Split

Ha-Ha.ai runs with **two repositories** and **two Vercel projects**:

| Layer | Git repository | Vercel project | Production domain | Purpose |
| --- | --- | --- | --- | --- |
| Landing | separate landing repo | `ha-ha-ai` | `https://ha-ha.ai` | marketing/landing pages only |
| App + API | `HAHA_app` (this repo) | `haha-app` | `https://app.ha-ha.ai` | Expo web app, mobile codebase, serverless API |

## Domain Ownership

- `ha-ha.ai` and `www.ha-ha.ai` should point to the landing project (`ha-ha-ai`).
- `app.ha-ha.ai` should point to the app project (`haha-app`) via Vercel-managed DNS/CNAME.
- API for clients is served from the same app origin:
  - `https://app.ha-ha.ai/api/*`

## Environment Matrix

### In `haha-app` (Vercel project for this repo)

Client/public env vars:

- `EXPO_PUBLIC_API_BASE_URL=https://app.ha-ha.ai/api`
- `EXPO_PUBLIC_CLAUDE_PROXY_URL=https://app.ha-ha.ai/api/claude`
- `EXPO_PUBLIC_SUPABASE_URL=<your-supabase-url>`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-or-publishable-key>`
- Stripe checkout URL vars (`EXPO_PUBLIC_STRIPE_CHECKOUT_URL_*`) as needed

Mobile note:

- For local/dev device builds and EAS profiles, keep the same API base (`https://app.ha-ha.ai/api`) to avoid web/mobile behavior drift.

Server-only secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `REVENUECAT_WEBHOOK_SECRET` (if RevenueCat endpoint enabled)
- other backend-only vars (`CLAUDE_*`, `ALLOWED_ORIGINS`, etc.)
- `DISABLE_IP_RATE_LIMIT=true` — opt-out of IP-level rate limiting (never set in production; for dev/test environments where Redis/KV is not available and `NODE_ENV` cannot be set to `development`)

### In `ha-ha-ai` (landing project)

- Keep only landing-site variables required by the landing repo.
- Do not duplicate backend secrets from app API unless landing repo truly needs them.

## Auth Callback URLs (Supabase)

Recommended callback allowlist:

- `hahaha://auth/callback`
- `hahaha://auth/callback?flow=recovery`
- `https://app.ha-ha.ai/auth/callback`
- `https://haha-app-delta.vercel.app/auth/callback` (optional preview/alias)

Email templates should use `{{ .ConfirmationURL }}` (not hardcoded callback links).
Magic Link FR/EN template reference: [`docs/supabase-magic-link-email-template.md`](/Users/laurentbernier/Documents/HAHA_app/docs/supabase-magic-link-email-template.md)

## Deployment Flow

### App (`haha-app`)

1. Push to the app repo branch linked to Vercel project `haha-app`.
2. Vercel runs `buildCommand` from [`vercel.json`](/Users/laurentbernier/Documents/HAHA_app/vercel.json):
   - `npm run export:web`
3. Vercel serves:
   - static web output from `dist-web`
   - serverless functions from `api/*`

Manual deploy:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx vercel --prod --yes --scope snadeau-breakingwalls-projects
```

Critical guardrail:

- This repo must stay linked to `snadeau-breakingwalls-projects/haha-app`.
- Never deploy this repo from `lbernier-2067s-projects`.
- If a local machine is linked to the wrong target, run:

```bash
npm run vercel:link:app
```

### Landing (`ha-ha-ai`)

- Deploy independently from landing repo.
- Keep app links pointing to `https://app.ha-ha.ai`.

## Operational Guardrails

- Avoid introducing a third app-web project name (`haha-app-web`) to prevent split env/drift.
- Keep one canonical app domain (`app.ha-ha.ai`) in all app env files and callback lists.
- If login appears reset after navigation, verify users are not bouncing between different app domains.
