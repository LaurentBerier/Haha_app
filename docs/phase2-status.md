# Phase 2 Status (Mobile + API)

Last updated: **2026-03-08**

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
- signup confirmation copy includes spam/junk reminder for Ha-Ha.ai email delivery
- auth gate + onboarding redirect in root routing
- onboarding data persisted to `public.profiles`
- onboarding UX polish:
  - visual step progress bar
  - explicit age-range validation message (13-120) before advancing
- global app-style header (brand logo + hamburger) keeps settings/user-space reachable on authenticated app screens (web + mobile)
- settings flows:
  - edit profile
  - language + display preferences
  - subscription plan screen (`Gratuit`, `Régulier`, `Premium`) with plan perks and direct Stripe CTAs
  - current plan + next billing cycle display
  - cancellation at period end for active Stripe subscriptions
  - sign out
  - delete account
- paid-tier voice direction set to ElevenLabs (strategy-level decision)
- website integration: `ha-ha.ai` now bridges authenticated `/app*` routes to this Expo app's web build
- web deployment pipeline stabilized:
  - `npm run export:web` applies module-script compatibility patch
  - `npm run deploy:web` targets Vercel project `haha-app-web`
- `POST /api/claude` protected with bearer token validation
  - server-side model whitelist
  - server-side monthly quota enforcement by tier
  - profile-backed monthly counter support (with graceful fallback to `usage_events` count)
  - server-side rate limiting
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
- history UX polish:
  - conversations grouped by recency (`Today`, `Yesterday`, `This week`, `Earlier`)
  - history screen now shows loading skeleton cards while persisted store hydration is in progress
- safety/empty-state polish:
  - delete-account flow now requires typed confirmation (`DELETE`) before irreversible action
  - richer chat empty state card (headline + guidance)
  - send button press animation for clearer action feedback
- interaction polish:
  - lightweight global toast system for non-blocking success/error/info feedback
  - onboarding option selection pulse animation
- chat input memory optimization:
  - image attachments now keep URI in component state
  - base64 payload is generated only at send time
- unit test baseline:
  - `npm run test:unit`
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
6. `POST /api/claude` returns `401` without bearer token.
7. Stripe checkout completed event reaches `POST /api/stripe-webhook` with `200`.
8. Subscription screen displays current plan + next cycle and can request cancellation.
9. `npm run deploy:web` publishes a working web app (no white-screen bootstrap crash).

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
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `REVENUECAT_WEBHOOK_SECRET` (required when webhook endpoint is enabled)
- `STRIPE_WEBHOOK_SECRET` (required for `POST /api/stripe-webhook`)
- `STRIPE_SECRET_KEY` (required for Stripe summary/cancel endpoints)
- `STRIPE_PAYMENT_LINK_ID_REGULAR` / `STRIPE_PAYMENT_LINK_ID_PREMIUM` (recommended)
- `STRIPE_PRICE_ID_REGULAR_MONTHLY` / `STRIPE_PRICE_ID_PREMIUM_MONTHLY` (recommended)
- `ALLOWED_ORIGINS` (required for browser clients that send `Origin`)
- `CLAUDE_MONTHLY_CAP_FREE` / `CLAUDE_MONTHLY_CAP_REGULAR` / `CLAUDE_MONTHLY_CAP_PREMIUM` (optional tier cap overrides)
- `ENABLE_ADMIN_TIER_GRANTS` (optional, defaults to disabled; set to `true` only when explicit admin-tier promotion is required)

Supabase URL config must include:

- `hahaha://auth/callback`
- `https://www.ha-ha.ai/auth/callback`
- `https://ha-ha.ai/auth/callback`
