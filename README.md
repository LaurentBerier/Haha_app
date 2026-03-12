# Ha-Ha.ai (Mobile App + Claude Proxy)

Ha-Ha.ai is an Expo React Native app with Supabase authentication, profile-driven onboarding, and a secured Claude proxy on Vercel.

## Current Scope

Implemented in this repository:

- Mobile app (`src/`) with Expo Router, Zustand, strict TypeScript.
- Supabase auth integration (email/password + Apple Sign-In).
- Auth gate and onboarding flow in app routing.
- Settings flow (profile edit, language preferences, motion preferences, subscription plan management, sign out, account deletion).
- Unified app-style top bar (logo left, center title, hamburger right) across authenticated mobile/web app screens.
- Universal back button on secondary routes (chat, mode selection, history, settings subpages).
- Header logo remains a home shortcut to artist selection (`/`) and never replaces back behavior.
- Chat header title reflects the active mode label (for example `🔥 Radar d’Attitude`) instead of a static "Discussion" title.
- Mode selection is now split into:
  - a category hub (`2x2` animated buttons)
  - a dedicated category page showing only its sub-modes/actions
- iOS mode-category navigation crash fix applied: category card animations now use a consistent JS driver on the same animated node (prevents `Attempting to run JS driven animation...` crash when opening `On Jase?`, `Blagues & Gagets`, `Jeux`, `Profil`).
- Main category labels:
  - `On Jase?`
  - `Blagues & Gagets`
  - `Jeux`
  - `Profil`
- Artist selection now distinguishes available vs upcoming artists with a clear CTA for available artists and "Disponible bientôt" cards for locked artists.
- Paid-tier voice strategy currently targets ElevenLabs.
- Subscription screen includes current plan, next billing cycle, and cancel-at-period-end for Stripe subscriptions.
- User profile model and profile personalization injection in system prompts.
- Gamification layer (score, titles, streak, mode-driven scoring) persisted in Zustand and synced with Supabase.
- Claude proxy (`api/claude.js`) with JWT validation via Supabase service role.
- Admin endpoint (`api/admin-account-type.js`) for account type assignment.
- Account deletion endpoint (`api/delete-account.js`).
- Usage summary endpoint (`api/usage-summary.js`) for monthly quota hydration.
- Score endpoint (`api/score.js`) for gamification actions and stats hydration.
- Payment webhooks:
  - RevenueCat (`api/payment-webhook.js`)
  - Stripe (`api/stripe-webhook.js`)
- Shared API utilities (`api/_utils.js`) for CORS, bearer token extraction, request IDs, env checks, and standardized errors.
- Extensible account type model (`free`, `regular`, `premium`, `admin`, plus custom).
- Unit test baseline (Jest) for API security contracts and core store slices.
- App web + API are deployed together from this repo to the Vercel project `haha-app` (custom domain: `app.ha-ha.ai`).
- Marketing/landing is maintained in a separate repo and deployed to a separate Vercel project (`ha-ha-ai`, domain `ha-ha.ai`).

## Repos and Vercel Projects

Two repositories and two Vercel projects are used in production:

1. Landing repo (separate)
   - Purpose: marketing/landing pages only
   - Vercel project: `ha-ha-ai`
   - Domain: `https://ha-ha.ai`

2. App repo (this repository)
   - Purpose: Expo app (web + mobile) and serverless API (`/api/*`)
   - Vercel project: `haha-app`
   - Domains: `https://app.ha-ha.ai` and project alias (`https://haha-app-delta.vercel.app`)

Important:

- The landing project no longer needs to bridge `/app*` routes.
- The app runs directly on `app.ha-ha.ai`.
- API calls should target the same app origin (`https://app.ha-ha.ai/api`).

## Stack

- Expo SDK 53
- React Native 0.79.6
- Expo Router
- Zustand
- Supabase (`@supabase/supabase-js`)
- Vercel serverless functions (`api/*.js`)

## Prerequisites

- Node.js 20+
- npm 10+
- Xcode + iOS runtimes
- CocoaPods
- (Optional E2E) `applesimutils`

## Local Setup

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm install
cp .env.example .env
```

## Environment Variables

### Mobile app (`.env`)

- `EXPO_PUBLIC_USE_MOCK_LLM`
- `EXPO_PUBLIC_CLAUDE_PROXY_URL`
- `EXPO_PUBLIC_API_BASE_URL` (recommended for non-Claude backend endpoints such as `/delete-account`)
- `EXPO_PUBLIC_ANTHROPIC_MODEL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL` (legacy single Stripe URL, fallback)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR`
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM`
- `EXPO_PUBLIC_PAYPAL_CHECKOUT_URL`
- `EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL`
- `EXPO_PUBLIC_E2E_AUTH_BYPASS` (test-only; used by Detox scripts)

Notes:

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` should use Supabase publishable/anon public key.
- These are public client vars; they are not server secrets.
- `EXPO_PUBLIC_USE_MOCK_LLM` defaults to `false` and should stay disabled in production.
- Current default Claude model: `claude-sonnet-4-6`.
- Production app-web values should typically be:
  - `EXPO_PUBLIC_API_BASE_URL=https://app.ha-ha.ai/api`
  - `EXPO_PUBLIC_CLAUDE_PROXY_URL=https://app.ha-ha.ai/api/claude`

### Vercel backend vars

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, required for JWT/user validation; can be legacy JWT-style `eyJ...` or secret-style `sb_secret_...`)
- `REVENUECAT_WEBHOOK_SECRET` (required if using `api/payment-webhook.js`; endpoint fails closed when missing)
- `STRIPE_WEBHOOK_SECRET` (required for `api/stripe-webhook.js` signature verification)
- `STRIPE_SECRET_KEY` (required for Stripe subscription read/cancel endpoints)
- `STRIPE_PAYMENT_LINK_ID_REGULAR` (optional but recommended; maps checkout session to `regular`)
- `STRIPE_PAYMENT_LINK_ID_PREMIUM` (optional but recommended; maps checkout session to `premium`)
- `STRIPE_PRICE_ID_REGULAR_MONTHLY` / `STRIPE_PRICE_ID_PREMIUM_MONTHLY` (recommended for subscription update events)
- `STRIPE_PRICE_ID_REGULAR_ANNUAL` / `STRIPE_PRICE_ID_PREMIUM_ANNUAL` (optional)
- `ALLOWED_ORIGINS` (required for browser callers that send `Origin`; comma-separated allowlist)
- `CLAUDE_RATE_LIMIT_MAX_REQUESTS` (optional, default `30`, per user)
- `CLAUDE_RATE_LIMIT_WINDOW_MS` (optional, default `60000`)
- `ANTHROPIC_FETCH_TIMEOUT_MS` (optional, default `25000`)
- `CLAUDE_MONTHLY_CAP_FREE` (optional, default `15`)
- `CLAUDE_MONTHLY_CAP_REGULAR` (optional, default `45`)
- `CLAUDE_MONTHLY_CAP_PREMIUM` (optional, default `110`)
- `CLAUDE_LIMITS_RPC` (optional, set `true` after SQL migration to use `public.enforce_claude_limits(...)`)
- `ENABLE_ADMIN_TIER_GRANTS` (optional, default disabled; required to allow `accountTypeId='admin'` through admin endpoint)

## Supabase Setup

### 1) Base profile schema

Create `public.profiles` and auth trigger first.

### 2) Account types

Run SQL in:

- `docs/supabase-account-types.sql`

This creates:

- `public.account_types`
- `public.profiles.account_type_id`
- seed account types: `free`, `regular`, `premium`, `admin`
- RLS hardening for account type safety
- JWT metadata sync trigger on account type changes
- `public.payment_events` ledger table
- `public.stripe_customer_links` mapping table
- `public.audit_logs` for privileged operation traces
- `public.usage_events` for Claude quota/rate limiting
- `public.profiles.monthly_message_count` + `monthly_reset_at` counters
- `public.enforce_claude_limits(...)` RPC (optional fast-path used by `/api/claude` when enabled)

## App Auth Flow

Routes:

- `/(auth)/login`
- `/(auth)/signup`
- `/(auth)/forgot-password`
- `/(auth)/reset-password`
- `/(auth)/onboarding`
- `/auth/callback`
- `/mode-select/[artistId]` (category hub)
- `/mode-select/[artistId]/[categoryId]` (category detail)
- `/settings`
- `/settings/edit-profile`
- `/settings/subscription`
- `/stats`

Behavior:

- Unauthenticated users are redirected to login.
- Authenticated users without completed/skipped onboarding are redirected to onboarding.
- Onboarding completion writes profile data to Supabase and saves the preferred display name used by Cathy.
- Signup confirmation screen instructs users to check spam/junk for Ha-Ha.ai confirmation emails.
- Password recovery links (`flow=recovery`) are handled by `/auth/callback` and routed to `/(auth)/reset-password`.
- Expired/invalid callback links now show a recovery screen with explicit actions to either sign in (resume onboarding) or restart signup.
- On native (iOS/Android), signup/reset redirects are forced to `hahaha://auth/callback`; web uses `/auth/callback`.
- E2E-only bypass exists via `EXPO_PUBLIC_E2E_AUTH_BYPASS=true` (used in Detox scripts; keep disabled outside tests).
- `Paramètres` (`/settings`) stays reachable from authenticated screens via header shortcut.
- Header logo returns to artist selection (`/`) and hamburger menu includes account routes plus auth action (sign in/sign up/sign out depending on state).
- Account-scoped local chat state is cleared automatically when session user changes, preventing cross-account conversation mixing on shared devices.
- Web controls now include subtle mouse-hover feedback (glow/brightness) on interactive buttons for clearer affordance.

Supabase URL configuration should include:

- `hahaha://auth/callback`
- `hahaha://auth/callback?flow=recovery`
- `https://app.ha-ha.ai/auth/callback`
- `https://haha-app-delta.vercel.app/auth/callback` (optional preview/alias)

Supabase email templates should use:

- `{{ .ConfirmationURL }}`

Do not hardcode callback links with `{{ .SiteURL }}/auth/callback?...` in templates, otherwise mobile deep links can break.

## Account Types and Admin

Account type registry:

- `src/config/accountTypes.ts`

Admin endpoint:

- `POST /api/admin-account-type`
- File: `api/admin-account-type.js`

Auth requirements:

- Bearer JWT from Supabase user with `app_metadata.role='admin'` or `app_metadata.account_type='admin'`
- `accountTypeId='admin'` is blocked unless `ENABLE_ADMIN_TIER_GRANTS=true`

Payload:

```json
{
  "userId": "<target-user-uuid>",
  "accountTypeId": "premium"
}
```

## Claude Proxy

Endpoint:

- `POST /api/claude`

Security:

- Requires `Authorization: Bearer <access_token>`
- Validates token using Supabase admin client
- Rejects invalid/missing token with `401` once CORS checks pass (requests without allowed origin/bearer are rejected earlier with `403`)
- Assembles the system prompt server-side from validated context (`artistId`, `modeId`, user profile); client cannot inject arbitrary system prompt text
- Enforces server-side model whitelist (only approved models are accepted)
- Enforces server-side monthly message quota by tier (`free`, `regular`, `premium`; `admin` unlimited)
- Enforces server-side per-user rate limit using `public.usage_events`
- Supports optional one-call limits path through Supabase RPC (`CLAUDE_LIMITS_RPC=true`)
- Includes in-memory limiter fallback when DB usage store is temporarily unavailable
- Browser-origin requests are fail-closed when `ALLOWED_ORIGINS` is missing or origin is not allowlisted
- Adds `X-Request-Id` response header for log correlation
- Error envelope: `{ "error": { "message": string, "code": string, "requestId": string } }`

## Account Deletion Endpoint

Endpoint:

- `POST /api/delete-account`

Security:

- Requires `Authorization: Bearer <access_token>`
- Validates token using Supabase admin client
- Deletes authenticated user via `auth.admin.deleteUser`
- Cascading FK cleanup handles profile-linked tables

## Billing and Subscription Endpoints

Endpoint:

- `GET /api/usage-summary`
- `POST /api/payment-webhook`
- `POST /api/stripe-webhook`
- `GET /api/subscription-summary`
- `POST /api/subscription-cancel`
- `GET /api/score`
- `POST /api/score`

Notes:

- Designed for RevenueCat-style payloads.
- Persists incoming events in `public.payment_events`.
- Maps product IDs to account types, updates `profiles.account_type_id`, and syncs JWT metadata.
- Fails closed in every environment when `REVENUECAT_WEBHOOK_SECRET` is missing.
- `usage-summary` returns `{ messagesUsed, messagesCap, resetDate }` for post-login quota hydration.
- `score` returns/stores gamification stats:
  - `GET /api/score` -> current counters (`score`, `roastsGenerated`, `punchlinesCreated`, `destructions`, `photosRoasted`, `memesGenerated`, `battleWins`, `dailyStreak`, `lastActiveDate`)
  - `POST /api/score` -> applies one `action` (`roast_generated`, `punchline_created`, `meme_generated`, `battle_win`, `daily_participation`, `photo_roasted`) and returns updated counters.
- Stripe webhook verifies `Stripe-Signature`, stores events in `public.payment_events`, maps plan IDs to tiers, and syncs account type claims.
- Stripe subscription endpoints allow client UI to display next billing cycle and request cancellation at period end.
- Subscription UI is plan-first (`Gratuit`, `Régulier`, `Premium`) and triggers Stripe checkout URLs directly for paid plans.
- Chat UI now exposes a compact score bar (`🔥 Score | 🎤 Titre`) linking to `/stats`.
- Mode browsing flow:
  - Category hub (`/mode-select/[artistId]`) with `On Jase?`, `Blagues & Gagets`, `Jeux`, `Profil`
  - Category detail (`/mode-select/[artistId]/[categoryId]`) with only relevant modes/actions
- Games flow:
  - Entry banner from history (`/history/[artistId]` -> `/games/[artistId]`)
  - Current game screens: `Impro Chaîne` and `Vrai ou Inventé`
- Mode catalog currently includes:
  - `On Jase?`: `Radar d'Attitude`, `Roast`, `Relax`, `Coach brutal`, `Je casse tout`
  - `Blagues & Gagets`: `Générateur de Meme`, `Analyste de Screenshots`, `Victime du Jour`, `Phrase du Jour`, `Numéro de Show`
  - `Jeux`: `Impro Chaîne`, `Vrai ou Inventé`
  - `Profil`: profile edit + recent chat history shortcuts

## Run

```bash
# Start Expo dev server
npm run start

# Launch React Native app on web (Expo web)
npm run web

# Launch simulator build
npm run ios

# Install/run on connected physical device (Debug, Metro required)
npx expo run:ios --device

# Install/run Release build on device (bundled JS, Metro not required)
npx expo run:ios --device --configuration Release

# Produce static web build artifacts (includes web compatibility patch)
npm run export:web

# Optional iOS Detox E2E
npm run e2e:build:ios
npm run e2e:ios
```

## Verify

```bash
npm run typecheck
npm run lint
npm run test:unit
```

API smoke tests:

```bash
./scripts/smoke-auth.sh
```

Optional E2E:

```bash
npm run e2e:build:ios
npm run e2e:ios
```

## Deploy to Vercel (`haha-app`)

```bash
npx vercel --prod --yes
```

This repository deploys both:

- Expo web app (exported to `dist-web`)
- Serverless API (`api/*.js`)

Current Vercel build settings are in [`vercel.json`](/Users/laurentbernier/Documents/HAHA_app/vercel.json):

- `buildCommand: npm run export:web`
- `outputDirectory: dist-web`
- SPA route fallback to `/index.html`

Optional local verification before deploy:

```bash
npm run export:web
```

Domain mapping (production):

- Landing: `https://ha-ha.ai` (separate repo/project)
- App: `https://app.ha-ha.ai` (this repo, `haha-app`)

`npm run deploy:web` now runs `npm run export:web` then `npx vercel --prod --yes` for the current `haha-app` topology.

Current [`.vercelignore`](/Users/laurentbernier/Documents/HAHA_app/.vercelignore) intentionally ignores only local/dev artifacts while keeping app source and API files deployable.

## Repo Layout

- Mobile app: `src/`
- Serverless API: `api/`
- Docs: `docs/`
- iOS native project: `ios/`

## Additional Docs

- `docs/architecture.md`
- `docs/repo-topology.md`
- `docs/economics.md`
- `docs/phase1-status.md`
- `docs/phase2-status.md`
- `docs/troubleshooting.md`
- `ha-ha-ai-build-prompt.improved.md`
