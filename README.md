# Ha-Ha.ai (Mobile App + Claude Proxy)

Ha-Ha.ai is an Expo React Native app with Supabase authentication, profile-driven onboarding, and a secured Claude proxy on Vercel.

## Current Scope

Implemented in this repository:

- Mobile app (`src/`) with Expo Router, Zustand, strict TypeScript.
- Supabase auth integration (email/password + Apple Sign-In).
- Auth gate and onboarding flow in app routing.
- Settings flow (profile edit, language preferences, motion preferences, subscription plan management, sign out, account deletion).
- Admin console flow (dashboard + user management) gated to admin sessions.
- Unified app-style top bar (logo left, center title, hamburger right) across authenticated mobile/web app screens.
- Universal back button on secondary routes (chat, mode selection, history, settings subpages).
- Header logo remains a home shortcut to artist selection (`/`) and never replaces back behavior.
- Chat header title reflects the active mode label (for example `🔥 Radar d’Attitude`) instead of a static "Discussion" title.
- Web chat input supports keyboard send: `Enter` sends, `Shift+Enter` inserts a new line.
- Chat image attachment now uses an explicit source picker (`library` or `camera`) and a preparation pipeline (`10MB` source cap, adaptive optimization to `<=3MB` upload payload).
- Mode selection is now split into:
  - a category hub (`2x2` animated buttons)
  - a dedicated category page showing only its sub-modes/actions
- iOS mode-category navigation crash fix applied: category card animations now use a consistent JS driver on the same animated node (prevents `Attempting to run JS driven animation...` crash when opening `On Jase?`, `Blagues & Gadgets`, `Jeux`, `Profil`).
- Main category labels:
  - `On Jase?`
  - `Blagues & Gadgets`
  - `Jeux`
  - `Profil`
- Artist selection now distinguishes available vs upcoming artists with a clear CTA for available artists and "Disponible bientôt" cards for locked artists.
- Tier-aware voice strategy is on ElevenLabs v3 (Free/Regular/Premium/Admin) with emotional audio tags support and display-safe tag stripping.
- Conversation naturelle (Phase 4) is integrated across chat and mode-select:
  - default-on conversation mode with shared composer UX and explicit mic states (`off`, `starting`, `listening`, `assistant_busy`, `paused_manual`, `recovering`, `paused_recovery`, `unsupported`, `error`)
  - conversation language resolution is per-conversation with explicit intent handling:
    - explicit switch command -> immediate switch on the active conversation
    - explicit one-off phrase/translation request -> one-turn language override without persistence
    - auto-detected language candidate -> injected yes/no confirmation before switching
  - when auto-detection is confirmed/rejected, the original pending message is replayed automatically in the selected language context
  - explicit language switches do not change global UI language; they persist on the active conversation only
  - STT silence auto-send (`1800ms` default) and strict STT/TTS mutual exclusion
  - STT starts with conversation locale and retries once with app locale when startup fails due to locale support
  - TTS forwards ISO language code when supported and retries once without `language_code` if provider rejects locale
  - session-based STT ownership (stale callbacks are ignored) + bounded recovery policy (`250ms`, `800ms`, `2000ms`, then explicit paused-recovery state)
  - right-mic action model: mode-off => enable+listen, active => pause, paused/recovery => resume, assistant-speaking => pause
  - inline mode-select conversation stack (no forced route switch)
  - mode-select greeting/tutorial auto-arms mic once per injected greeting message, while respecting manual user override
  - first-pass mode-select greeting boot cycle is now run-scoped and finalized on every exit path (success/cancel/timeout/unmount), preventing stuck loading loops after signup
  - greeting API retries are prolonged inside a global `25s` budget; when budget is exhausted, local fallback greeting text is injected so loading always closes
  - first-session greeting with weather/news signal context
  - replay remains one-message-at-a-time and current-conversation scoped, but web focus/visibility auto-replay is disabled to avoid surprise replays
  - chunk-synced text/voice playback keyed by `message.id` with animated waveform replay control (`loading`, `playing`, `idle/play`)
  - mode-select conversation overlay expands up to compact top controls (instead of fixed half-screen clamp)
  - compact mode-select now disables background page scrolling to prevent the duplicate right-edge scrollbar on web while keeping message-list scroll active
  - mode-select conversation binding is stabilized with explicit `boundConversationId` ownership, send-time target recovery, and no silent send drops on transient context mismatch
  - mode-select web message list rendering is hardened for longer sessions (wider render window + no clipping/virtualization in inline overlay)
  - Cathy voice controls now use explicit states (`ready`, `generating`, `unavailable`) with inline retry instead of silent playback-button disappearance
- Meme generator reliability hardening:
  - meme mode launch now inserts a single Cathy intro message (no duplicate upload prompt injection)
  - meme intros explicitly mention using the small `+` button on the left of the composer to upload an image
  - meme images in chat bubbles keep full-frame visibility (`contain`) for option/final assets so top/bottom caption bands stay visible
  - meme renderer enforces deterministic white captions on black bands with embedded font registration in serverless runtime
  - meme logo is rendered at a stable small size with reserved lane spacing to avoid overlap with bottom captions
  - web meme share now falls back to browser download/mailto when native share API is unavailable or throws
- Root stack now registers `admin` as nested entry only (child admin screens stay in `src/app/admin/_layout.tsx`) to avoid `No route named "admin/index"` console warnings.
- Subscription screen includes current plan, next billing cycle, and cancel-at-period-end for Stripe subscriptions.
- User profile model and profile personalization injection in system prompts.
- Gamification layer (score, titles, streak, mode-driven scoring) persisted in Zustand and synced with Supabase.
- Claude proxy (`api/claude.js`) with JWT validation via Supabase service role.
- Admin endpoint (`api/admin-account-type.js`) for account type assignment.
- Admin analytics and operations endpoints:
  - `GET /api/admin-stats`
  - `GET /api/admin-users`
  - `POST /api/admin-quota-override`
- Account deletion endpoint (`api/delete-account.js`).
- Usage summary endpoint (`api/usage-summary.js`) for monthly quota hydration.
- Score endpoint (`api/score.js`) for gamification actions and stats hydration.
- TTS endpoint (`/api/tts` via `api/claude.js` proxy -> `src/server/ttsHandler.js`) for ElevenLabs voice generation (tier-aware caps/rate-limits, CORS protected).
- Payment webhooks:
  - RevenueCat (`api/payment-webhook.js`)
  - Stripe (`api/stripe-webhook.js`)
- Sentry exception capture is integrated on app and API runtimes (DSN-driven, disabled when unset).
- Shared API utilities (`api/_utils.js`) for CORS, bearer token extraction, request IDs, env checks, and standardized errors.
- Extensible account type model (`free`, `regular`, `premium`, `admin`, plus custom).
- Primary-thread cross-device sync via Supabase keeps each artist primary conversation metadata/messages aligned across devices (bootstrap + focus/app-active refresh + post-reply sync).
- Unit test baseline (Jest) for API security contracts and core store slices.
- App web + API are deployed together from this repo to the Vercel project `haha-app` (custom domain: `app.ha-ha.ai`).
- Marketing/landing is maintained in a separate repo and deployed to a separate Vercel project (`ha-ha-ai`, domain `ha-ha.ai`).

## Status Tracking

- [`docs/phase1-status.md`](/Users/laurentbernier/Documents/HAHA_app/docs/phase1-status.md)
- [`docs/phase2-status.md`](/Users/laurentbernier/Documents/HAHA_app/docs/phase2-status.md)
- [`docs/phase3-status.md`](/Users/laurentbernier/Documents/HAHA_app/docs/phase3-status.md)
- [`docs/phase4-status.md`](/Users/laurentbernier/Documents/HAHA_app/docs/phase4-status.md)
- Admin dashboard status: [`docs/admin-dashboard-status.md`](/Users/laurentbernier/Documents/HAHA_app/docs/admin-dashboard-status.md)
- Latest QA run: [`docs/qa-run-2026-04-04.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-04-04.md)
- Latest code-review snapshot: [`docs/code-review-2026-04-04.md`](/Users/laurentbernier/Documents/HAHA_app/docs/code-review-2026-04-04.md)
- Pre-release conversation reset checklist: [`docs/pre-release-reset-checklist.md`](/Users/laurentbernier/Documents/HAHA_app/docs/pre-release-reset-checklist.md)

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

Mandatory deployment target for this repo:

- Team/scope: `snadeau-breakingwalls-projects`
- Project: `haha-app`
- Do not create or deploy this repo in `lbernier-2067s-projects`.
- If link is wrong, relink with:
  - `npm run vercel:link:app`

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
- `EXPO_PUBLIC_STRIPE_MODE` (`live` or `test`; defaults to `live`)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR_TEST` (optional; used when `EXPO_PUBLIC_STRIPE_MODE=test`)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM_TEST` (optional; used when `EXPO_PUBLIC_STRIPE_MODE=test`)
- `EXPO_PUBLIC_PAYPAL_CHECKOUT_URL`
- `EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL`
- `EXPO_PUBLIC_E2E_AUTH_BYPASS` (test-only; used by Detox scripts)
- `EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC` (optional; defaults to ElevenLabs built-in voice ID)
- `EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY` (optional; when set, premium voice swaps without code changes)
- `EXPO_PUBLIC_SENTRY_DSN` (optional; enables app-side exception capture)
- `EXPO_PUBLIC_SILENCE_TIMEOUT_MS` (optional; default `1800`, minimum effective `1200`)
- `EXPO_PUBLIC_VOICE_FILLER_COOLDOWN_MS` (optional; default `2500`, minimum effective `400`)
- `EXPO_PUBLIC_GREETING_FORCE_TUTORIAL` (optional; forces tutorial greeting copy on client)

Notes:

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` should use Supabase publishable/anon public key.
- These are public client vars; they are not server secrets.
- `EXPO_PUBLIC_USE_MOCK_LLM` defaults to `false` and should stay disabled in production.
- Current default Claude model: `claude-sonnet-4-6`.
- For this app, keep `EXPO_PUBLIC_API_BASE_URL` at API root (`.../api`, not `.../api/claude`).
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
- `STRIPE_WEBHOOK_SECRET_TEST` (recommended when Stripe test mode is enabled)
- `STRIPE_SECRET_KEY_TEST` (recommended when Stripe test mode is enabled)
- `STRIPE_PAYMENT_LINK_ID_REGULAR_TEST` / `STRIPE_PAYMENT_LINK_ID_PREMIUM_TEST` (recommended for sandbox payment links)
- `STRIPE_PRICE_ID_REGULAR_MONTHLY_TEST` / `STRIPE_PRICE_ID_PREMIUM_MONTHLY_TEST` (recommended for sandbox subscription updates)
- `ALLOWED_ORIGINS` (required for browser callers that send `Origin`; comma-separated allowlist)
- `ELEVENLABS_API_KEY` (required for `/api/tts` / `src/server/ttsHandler.js`; server-only, never `EXPO_PUBLIC_`)
- `ELEVENLABS_MODEL_ID` (optional; supports aliases: `3`, `v3`, `eleven_v3`, `2.5`, `v2.5`, `eleven_turbo_v2_5`)
- `ELEVENLABS_VOICE_ID_GENERIC` (optional server-side override)
- `ELEVENLABS_VOICE_ID_CATHY` (optional server-side Cathy override; recommended)
- `ELEVENLABS_VOICE_ID_REGULAR` / `ELEVENLABS_VOICE_ID_PREMIUM` (optional per-tier explicit overrides)
- `ELEVENLABS_USE_CATHY_FOR_ALL_PAID` (optional; default `true`)
- `CLAUDE_RATE_LIMIT_MAX_REQUESTS` (optional, default `30`, per user)
- `CLAUDE_RATE_LIMIT_WINDOW_MS` (optional, default `60000`)
- `CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS` (optional, default `100`, per client IP)
- `CLAUDE_IP_RATE_LIMIT_WINDOW_MS` (optional, default `60000`)
- `ANTHROPIC_FETCH_TIMEOUT_MS` (optional, default `25000`)
- `IMPRO_THEMES_FETCH_TIMEOUT_MS` (optional; if unset, `/api/impro-themes` uses `max(35000, ANTHROPIC_FETCH_TIMEOUT_MS)`)
- `CLAUDE_CONTEXT_ENABLED` (optional; set `0` to disable weather/news context injection)
- `CLAUDE_CONTEXT_FETCH_TIMEOUT_MS` (optional, default `4500`)
- `CLAUDE_IP_GEO_TIMEOUT_MS` (optional, default `3000`)
- `CLAUDE_MONTHLY_CAP_FREE` (optional, default `200`)
- `CLAUDE_MONTHLY_CAP_REGULAR` (optional, default `3000`)
- `CLAUDE_MONTHLY_CAP_PREMIUM` (optional, default `25000`)
- `CLAUDE_LIMITS_RPC` (optional, set `true` after SQL migration to use `public.enforce_claude_limits(...)`)
- `TTS_MONTHLY_CAP_FREE` (optional, default `80`)
- `TTS_MONTHLY_CAP_REGULAR` (optional, default `2000`)
- `TTS_MONTHLY_CAP_PREMIUM` (optional, default `20000`)
- `TTS_RATE_LIMIT_MAX_REQUESTS_FREE` (optional, default `20`/min)
- `TTS_RATE_LIMIT_MAX_REQUESTS_REGULAR` (optional, default `60`/min)
- `TTS_RATE_LIMIT_MAX_REQUESTS_PREMIUM` (optional, default `180`/min)
- `TTS_RATE_LIMIT_MAX_REQUESTS` (optional shared fallback when tier-specific values are not set)
- `TTS_IP_RATE_LIMIT_MAX_REQUESTS` (optional, default `100`, per client IP)
- `TTS_IP_RATE_LIMIT_WINDOW_MS` (optional, default `60000`)
- `GREETING_FORCE_TUTORIAL` (optional; serves deterministic tutorial greeting copy from API)
- `GREETING_HEADLINE_INCLUSION_RATE` (optional probability, default `0.3`)
- `GREETING_IP_TIMEOUT_MS` / `GREETING_WEATHER_TIMEOUT_MS` / `GREETING_NEWS_TIMEOUT_MS` (optional, default `4500`)
- `KV_URL` or (`KV_REST_API_URL` + `KV_REST_API_TOKEN`) or (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) for cross-instance KV-backed rate limiting
- `ENABLE_ADMIN_TIER_GRANTS` (optional, default disabled; required to allow `accountTypeId='admin'` through admin endpoint)
- `SENTRY_DSN` (optional; enables API-side exception capture)

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
- `/admin` (admin-only)
- `/admin/users` (admin-only)

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
- Admin users now see `Admin Dashboard` in both settings and hamburger account menu.
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

Admin app routes:

- `/admin` (dashboard UI)
- `/admin/users` (user operations UI)

Admin dashboard API endpoints:

- `GET /api/admin-stats`
- `GET /api/admin-users`
- `POST /api/admin-quota-override`

Current dashboard state snapshot:

- [`docs/admin-dashboard-status.md`](/Users/laurentbernier/Documents/HAHA_app/docs/admin-dashboard-status.md)

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
- Applies multi-threshold quota degradation:
  - `soft1` (`>=75%`): reduced token/context budget while staying on primary model
  - `soft2` (`>=90%`): switches from Sonnet to Haiku with tighter token/context budgets
  - `economy` (`>=100%`): still responds with reduced context/token budget before hard-block threshold
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
- `usage-summary` returns `{ messagesUsed, messagesCap, resetDate, softCapReached, economyMode }` for post-login quota hydration.
- `score` returns/stores gamification stats:
  - `GET /api/score` -> current counters (`score`, `roastsGenerated`, `punchlinesCreated`, `destructions`, `photosRoasted`, `memesGenerated`, `battleWins`, `dailyStreak`, `lastActiveDate`)
  - `POST /api/score` -> applies one `action` (`roast_generated`, `punchline_created`, `meme_generated`, `battle_win`, `daily_participation`, `photo_roasted`) and returns updated counters.
- Stripe webhook verifies `Stripe-Signature`, stores events in `public.payment_events`, maps plan IDs to tiers, and syncs account type claims.
- Stripe subscription endpoints allow client UI to display next billing cycle and request cancellation at period end.
- Subscription UI is plan-first (`Gratuit`, `Régulier`, `Premium`) and triggers Stripe checkout URLs directly for paid plans.
- Score bar (`🔥 Score | 🎤 Titre`) is intentionally shown only in game screens (not standard chat).
- Mode browsing flow:
  - Category hub (`/mode-select/[artistId]`) with `On Jase?`, `Blagues & Gadgets`, `Jeux`, `Profil`
  - Category detail (`/mode-select/[artistId]/[categoryId]`) with only relevant modes/actions
- Games flow:
  - Entry from mode category (`/mode-select/[artistId]/battles` -> `/games/[artistId]`)
  - Current game screens: `Histoire improvisée`, `Vrai ou Inventé`, and `Tirage de Tarot`
- Mode catalog currently includes:
  - `On Jase?`: `On jase!`, `Mets-moi sur le grill`
  - `Blagues & Gadgets`: `Générateur de Meme`, `Analyste de Screenshots`, `Numéro de Show`
  - `Jeux`: `Histoire improvisée`, `Vrai ou Inventé`
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

# Mobile tooling preflight (iOS/Android prerequisites)
npm run check:mobile-env
```

## Verify

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run qa:phase23
```

CI automation:

- Workflow: [`.github/workflows/phase23-ci.yml`](/Users/laurentbernier/Documents/HAHA_app/.github/workflows/phase23-ci.yml)
- Trigger: push + pull request on `main`
- Checks: `typecheck`, `lint`, `verify:profile-prompt`, `test:unit`
- Actions runtime policy: `actions/checkout@v6` and `actions/setup-node@v6` (Node24-compatible, avoids GitHub Node20 deprecation warning)

API smoke tests:

```bash
npm run smoke:auth
npm run smoke:voice
```

Single-command QA (Phase 2/3):

```bash
npm run qa:phase23
```

Optional E2E:

```bash
npm run e2e:build:ios
npm run e2e:ios
```

## Deploy to Vercel (`haha-app`)

```bash
npx vercel --prod --yes --scope snadeau-breakingwalls-projects
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

`npm run deploy:web` now enforces the Vercel link (`snadeau-breakingwalls-projects/haha-app`), runs `npm run export:web`, then deploys with `--scope snadeau-breakingwalls-projects`.

Current [`.vercelignore`](/Users/laurentbernier/Documents/HAHA_app/.vercelignore) intentionally ignores only local/dev artifacts while keeping app source and API files deployable.

## Stripe Pre-Deploy Checklist

Use this checklist before shipping subscription changes (test or live):

1. Confirm app env mode and checkout URLs:
   - `EXPO_PUBLIC_STRIPE_MODE=live` or `test`
   - `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR` / `PREMIUM` (live)
   - `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR_TEST` / `PREMIUM_TEST` (test mode)
2. Confirm backend Stripe secrets in Vercel:
   - live: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`
   - test: `STRIPE_WEBHOOK_SECRET_TEST`, `STRIPE_SECRET_KEY_TEST`
3. Confirm Stripe plan mapping vars:
   - live: `STRIPE_PAYMENT_LINK_ID_*`, `STRIPE_PRICE_ID_*`
   - test: `STRIPE_PAYMENT_LINK_ID_*_TEST`, `STRIPE_PRICE_ID_*_TEST`
4. Confirm Stripe webhook destination URL exactly matches:
   - `https://app.ha-ha.ai/api/stripe-webhook`
5. Confirm Stripe sends these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
6. Redeploy `haha-app` after every env change:
   - `npx vercel --prod --yes --scope snadeau-breakingwalls-projects`
7. Validate in Stripe with `Send test event` / `Resend` and verify `200 OK`.

## Repo Layout

- Mobile app: `src/`
- Serverless API: `api/`
- Docs: `docs/`
- iOS native project: `ios/`

## Additional Docs

- `docs/architecture.md`
- `docs/admin-dashboard-status.md`
- `docs/repo-topology.md`
- `docs/economics.md`
- `docs/phase1-status.md`
- `docs/phase2-status.md`
- `docs/phase3-status.md`
- `docs/phase3-qa-matrix.md`
- `docs/qa-run-2026-03-14.md`
- `docs/qa-run-2026-03-17.md`
- `docs/qa-run-2026-03-18.md`
- `docs/qa-run-2026-03-19.md`
- `docs/qa-run-2026-03-20.md`
- `docs/qa-run-2026-03-21.md`
- `docs/qa-run-2026-03-22.md`
- `docs/qa-run-2026-03-23.md`
- `docs/qa-run-2026-03-24.md`
- `docs/qa-run-2026-03-27.md`
- `docs/qa-run-2026-03-28.md`
- `docs/qa-run-2026-04-01.md`
- `docs/qa-run-2026-04-02.md`
- `docs/qa-run-2026-04-03.md`
- `docs/qa-run-2026-04-04.md`
- `docs/code-review-2026-03-15.md`
- `docs/code-review-2026-03-16.md`
- `docs/code-review-2026-03-17.md`
- `docs/code-review-2026-03-20.md`
- `docs/code-review-2026-03-27.md`
- `docs/code-review-2026-03-28.md`
- `docs/code-review-2026-04-01.md`
- `docs/code-review-2026-04-03.md`
- `docs/code-review-2026-04-04.md`
- `docs/voice-ops-runbook.md`
- `docs/troubleshooting.md`
- `ha-ha-ai-build-prompt.improved.md`
