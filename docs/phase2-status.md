# Phase 2 Status (Mobile + API)

Last updated: **2026-03-12**

## Scope

Phase 2 objective is to move from anonymous MVP behavior to authenticated, profile-aware, cross-platform user flows backed by Supabase.

Core targets:

- Supabase auth integration
- onboarding and profile persistence
- auth-protected Claude proxy
- account type groundwork for billing/entitlements

## Delivered

- Supabase client wired in app with persisted sessions
- Email/password auth screens:
  - login
  - signup
  - forgot password
  - reset password
- Apple Sign-In support
- auth callback handling for signup and recovery flows
- auth callback recovery UX for expired/invalid links (resume via login or restart signup)
- native auth redirect hardening: iOS/Android signup/reset now force `hahaha://auth/callback`
- web callback mobile-browser handoff to native app deep link when auth payload is present
- signup confirmation copy includes spam/junk reminder for Ha-Ha.ai email delivery
- auth gate + onboarding redirect in root routing
- onboarding data persisted to `public.profiles`
- onboarding UX polish:
  - preferred display-name question added during onboarding (used by Cathy personalization)
  - visual step progress bar
  - explicit age-range validation message (13-120) before advancing
- global app-style header (brand logo + hamburger) keeps settings/user-space reachable on authenticated app screens (web + mobile)
- navigation UX hardening:
  - universal back button on secondary routes
  - home header keeps logo + hamburger with no redundant center title
  - chat header center title reflects active mode (`emoji + mode label`)
  - iOS category-menu stability fix: resolved animated-driver conflict that could crash when opening `On Jase?`, `Blagues & Gagets`, `Jeux`, or `Profil`
- settings flows:
  - edit profile
  - preferred display-name editing
  - language + motion preferences (dark mode is fixed)
  - subscription plan screen (`Gratuit`, `Régulier`, `Premium`) with plan perks and direct Stripe CTAs
  - current plan + next billing cycle display
  - cancellation at period end for active Stripe subscriptions
  - sign out
  - delete account
- paid-tier voice direction set to ElevenLabs (strategy-level decision)
- deployment topology now split cleanly:
  - landing website in separate repo/project (`ha-ha-ai`) on `https://ha-ha.ai`
  - app web + API in this repo/project (`haha-app`) on `https://app.ha-ha.ai`
- web deployment pipeline stabilized:
  - `npm run export:web` applies module-script compatibility patch
  - Vercel production deploy uses `npx vercel --prod --yes` on project `haha-app`
- `POST /api/claude` protected with bearer token validation
  - server-side model whitelist
  - server-side artist-aware prompt assembly (Cathy + placeholder artists)
  - prompt language alignment (FR/EN) based on active app language
  - server-side monthly quota enforcement by tier
  - profile-backed monthly counter support (with graceful fallback to `usage_events` count)
  - server-side rate limiting
  - optional single-RPC limits path (`CLAUDE_LIMITS_RPC=true`) to combine quota + rate-limit + usage insert into one DB round-trip
- `POST /api/delete-account` endpoint
- `GET /api/usage-summary` endpoint (quota hydration after login)
- Stripe subscription API endpoints:
  - `GET /api/subscription-summary`
  - `POST /api/subscription-cancel`
- account type infrastructure:
  - SQL + RLS hardening
  - `POST /api/admin-account-type`
- payment webhook integration:
  - `POST /api/payment-webhook`
  - `POST /api/stripe-webhook`
  - Stripe signature verification now uses official `stripe.webhooks.constructEvent` with strict raw-body validation
  - webhook-driven account changes now emit best-effort audit log rows (`audit_logs`)
  - `payment_events` supports provider-level idempotency key (`provider_event_id`) with unique index
  - webhook handlers are backward-compatible during staggered DB rollout (auto-fallback insert when `provider_event_id` column is still missing)
- API hardening pass:
  - shared utility module (`api/_utils.js`) for CORS/auth/error/request-id
  - browser CORS fail-closed behavior when `ALLOWED_ORIGINS` is missing or origin is not allowlisted
  - missing `Origin` now requires explicit auth (or explicit route opt-in) to reduce no-origin abuse paths
  - webhook auth fail-closed in all environments when `REVENUECAT_WEBHOOK_SECRET` is missing
  - admin account-type endpoint blocks `accountTypeId=admin` unless `ENABLE_ADMIN_TIER_GRANTS=true`
  - best-effort audit log helper shared in `api/_utils.js` for privileged operations
  - standardized API error format with error codes and request IDs
  - Vercel deployment compatibility fix: removed unsupported `bodyParser` property from `vercel.json` function schema
- chat/feed polish:
  - animated streaming indicator dots
  - optimized message-slice updates with per-conversation message index map to reduce per-token update cost
  - smoother route transitions between mode/history/chat
  - Claude handler now overlaps prompt profile fetch with quota/rate-limit checks to reduce pre-stream latency
  - Claude handler now also preloads the rate-limit usage count in parallel with monthly quota verification
- history UX polish:
  - conversations grouped by recency (`Today`, `Yesterday`, `This week`, `Earlier`)
  - history screen now shows loading skeleton cards while persisted store hydration is in progress
- artist-selection UX polish:
  - locked artists use a neutral comedian silhouette placeholder avatar (instead of `???`)
  - legacy `PRO` lock badge replaced by a discrete "Disponible bientôt" badge/state
  - available artist card exposes explicit CTA (`Parler avec Cathy`)
- games module (phase 1) active via history banner:
  - game hub: `/games/[artistId]`
  - `Impro Chaîne` (streaming collaborative story)
  - `Vrai ou Inventé` (5-round quiz flow)
- safety/empty-state polish:
  - delete-account flow now requires typed confirmation (`DELETE`) before irreversible action
  - richer chat empty state card (headline + guidance)
  - send button press animation for clearer action feedback
- interaction polish:
  - lightweight global toast system for non-blocking success/error/info feedback
  - onboarding option selection pulse animation
  - motion accessibility control:
    - system `Reduce Motion` is respected
    - user override added in Settings (`Système`, `Animations activées`, `Animations réduites`)
- billing UX polish:
  - subscription screen now detects checkout return (app foreground/web focus), refreshes auth session, and reloads subscription status automatically
  - successful checkout sync now shows explicit toast feedback
- personality engine architecture:
  - added artist prompt registry (`src/services/artistPromptRegistry.ts`) so prompt assembly is artist-aware and no longer Cathy-only by design
- chat input memory optimization:
  - image attachments now keep URI in component state
  - base64 payload is generated only at send time
- account-scoped persistence safety:
  - persisted snapshot now stores `ownerUserId`
  - local conversations/messages are cleared automatically when auth user changes
  - prevents cross-account conversation bleed on shared browsers/devices
- unit test baseline:
  - `npm run test:unit`
  - added tests for subscription sync/checkout URL shaping and for artist-aware prompt builder
  - added service tests for `authService` and `claudeApiService`
  - API tests for `claude`, `delete-account`, `admin-account-type`, `payment-webhook`, and shared utils
  - store slice tests for `subscriptionSlice` and `usageSlice`
- E2E baseline stabilized on iOS:
  - `npm run e2e:build:ios`
  - `npm run e2e:ios`
  - auth bypass is test-scoped via `EXPO_PUBLIC_E2E_AUTH_BYPASS=true` in package scripts

## In Progress

- end-to-end production validation of full auth/recovery flow on physical devices
- PayPal/Apple checkout enablement (URLs and backend linkage)
- stronger automated integration coverage beyond current E2E happy-path set

## Planned Next

- Stripe customer portal / subscription-management deep link
- webhook observability dashboard (event success/failure + retry tracking)
- broaden entitlement sync checks post-webhook (periodic reconciliation)
- add integration/e2e tests for:
  - signup confirm callback
  - password recovery callback
  - onboarding complete/skip
  - claude proxy 401/200 contract
  - subscription checkout return flow
- improve operational monitoring around auth and proxy endpoints

## Verification Baseline

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run e2e:build:ios
npm run e2e:ios
```

Manual checks:

1. Sign up -> confirmation email -> callback -> onboarding.
2. Re-open an old/consumed confirmation link -> callback shows recovery actions (login or restart signup) instead of dead-end loop.
3. Forgot password -> recovery email -> reset password -> login succeeds.
4. Unauthenticated user is redirected to login.
5. Authenticated user without onboarding is redirected to onboarding.
6. `POST /api/claude` with invalid bearer returns `401` (and missing-origin/no-bearer requests are blocked with `403` by CORS guard).
7. Stripe checkout completed event reaches `POST /api/stripe-webhook` with `200`.
8. Subscription screen displays current plan + next cycle and can request cancellation.
9. `npx vercel --prod --yes` publishes a working web app (no white-screen bootstrap crash).
10. Sign in with user A, create messages, sign out and sign in with user B -> no conversation history leakage from user A.

## Dependencies and Config

Required app env:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_CLAUDE_PROXY_URL`
- `EXPO_PUBLIC_API_BASE_URL` (recommended for non-Claude API routes like `/delete-account`)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL` (legacy fallback)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR` (required for regular paid CTA)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM` (required for premium paid CTA)
- `EXPO_PUBLIC_PAYPAL_CHECKOUT_URL` (optional, reserved for future provider wiring)
- `EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL` (optional, reserved for future provider wiring)
- `EXPO_PUBLIC_E2E_AUTH_BYPASS` (test-only, should stay false/unset outside E2E)

Required backend env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server secret; legacy JWT-style `eyJ...` or `sb_secret_...`)
- `ANTHROPIC_API_KEY`
- `REVENUECAT_WEBHOOK_SECRET` (required when webhook endpoint is enabled)
- `STRIPE_WEBHOOK_SECRET` (required for `POST /api/stripe-webhook`)
- `STRIPE_SECRET_KEY` (required for Stripe summary/cancel endpoints)
- `STRIPE_PAYMENT_LINK_ID_REGULAR` / `STRIPE_PAYMENT_LINK_ID_PREMIUM` (recommended)
- `STRIPE_PRICE_ID_REGULAR_MONTHLY` / `STRIPE_PRICE_ID_PREMIUM_MONTHLY` (recommended)
- `ALLOWED_ORIGINS` (required for browser clients that send `Origin`)
- `CLAUDE_MONTHLY_CAP_FREE` / `CLAUDE_MONTHLY_CAP_REGULAR` / `CLAUDE_MONTHLY_CAP_PREMIUM` (optional tier cap overrides)
- `CLAUDE_LIMITS_RPC` (optional, set `true` after running the latest SQL function migration for `enforce_claude_limits`)
- `ENABLE_ADMIN_TIER_GRANTS` (optional, defaults to disabled; set to `true` only when explicit admin-tier promotion is required)

Supabase URL config must include:

- `hahaha://auth/callback`
- `hahaha://auth/callback?flow=recovery`
- `https://app.ha-ha.ai/auth/callback`
- `https://haha-app-delta.vercel.app/auth/callback` (optional preview/alias)

Supabase email templates must use:

- `{{ .ConfirmationURL }}` (avoid hardcoded `{{ .SiteURL }}/auth/callback?...` links)
