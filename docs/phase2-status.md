# Phase 2 Status (Mobile + API)

Last updated: **2026-03-07**

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
- global app-style header (brand logo + hamburger) keeps settings/user-space reachable on authenticated app screens (web + mobile)
- settings flows:
  - edit profile
  - language + display preferences
  - subscription provider integration (Stripe regular/premium links, PayPal, Apple checkout links)
  - sign out
  - delete account
- paid-tier voice direction set to ElevenLabs (strategy-level decision)
- website integration: `ha-ha.ai` now bridges authenticated `/app*` routes to this Expo app's web build
- web deployment pipeline stabilized:
  - `npm run export:web` applies module-script compatibility patch
  - `npm run deploy:web` targets Vercel project `haha-app-web`
- `POST /api/claude` protected with bearer token validation
- `POST /api/delete-account` endpoint
- account type infrastructure:
  - SQL + RLS hardening
  - `POST /api/admin-account-type`
- payment webhook scaffold:
  - `POST /api/payment-webhook`
  - `POST /api/stripe-webhook`
- API hardening pass:
  - shared utility module (`api/_utils.js`) for CORS/auth/error/request-id
  - browser CORS fail-closed behavior when `ALLOWED_ORIGINS` is missing or origin is not allowlisted
  - webhook auth fail-closed in all environments when `REVENUECAT_WEBHOOK_SECRET` is missing
  - standardized API error format with error codes and request IDs
- unit test baseline:
  - `npm run test:unit`
  - API tests for `claude`, `delete-account`, `admin-account-type`, `payment-webhook`, and shared utils
  - store slice tests for `subscriptionSlice` and `usageSlice`

## In Progress

- end-to-end production validation of full auth/recovery flow on physical devices
- payment provider integration (webhook currently scaffolded)
- Stripe webhook deployment and dashboard event wiring in production
- stronger automated integration coverage

## Planned Next

- integrate billing provider (RevenueCat/Stripe decision path)
- connect Stripe customer portal / self-serve cancel flow
- complete entitlement hydration from backend source of truth post-login
- add integration/e2e tests for:
  - signup confirm callback
  - password recovery callback
  - onboarding complete/skip
  - claude proxy 401/200 contract
- improve operational monitoring around auth and proxy endpoints

## Verification Baseline

```bash
npm run typecheck
npm run lint
npm run test:unit
```

Manual checks:

1. Sign up -> confirmation email -> callback -> onboarding.
2. Re-open an old/consumed confirmation link -> callback shows recovery actions (login or restart signup) instead of dead-end loop.
3. Forgot password -> recovery email -> reset password -> login succeeds.
4. Unauthenticated user is redirected to login.
5. Authenticated user without onboarding is redirected to onboarding.
6. `POST /api/claude` returns `401` without bearer token.
7. `npm run deploy:web` publishes a working web app (no white-screen bootstrap crash).

## Dependencies and Config

Required app env:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_CLAUDE_PROXY_URL`
- `EXPO_PUBLIC_API_BASE_URL` (recommended for non-Claude API routes like `/delete-account`)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL` (legacy fallback)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR` (optional, Stripe regular plan link)
- `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM` (optional, Stripe premium plan link)
- `EXPO_PUBLIC_PAYPAL_CHECKOUT_URL` (optional, enables PayPal CTA in subscription screen)
- `EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL` (optional, enables Apple Pay CTA in subscription screen)

Required backend env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `REVENUECAT_WEBHOOK_SECRET` (required when webhook endpoint is enabled)
- `STRIPE_WEBHOOK_SECRET` (required for `POST /api/stripe-webhook`)
- `STRIPE_PAYMENT_LINK_ID_REGULAR` / `STRIPE_PAYMENT_LINK_ID_PREMIUM` (recommended)
- `STRIPE_PRICE_ID_REGULAR_MONTHLY` / `STRIPE_PRICE_ID_PREMIUM_MONTHLY` (recommended)
- `ALLOWED_ORIGINS` (required for browser clients that send `Origin`)

Supabase URL config must include:

- `hahaha://auth/callback`
- `https://www.ha-ha.ai/auth/callback`
- `https://ha-ha.ai/auth/callback`
