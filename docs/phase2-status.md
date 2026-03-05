# Phase 2 Status (Mobile + API)

Last updated: **2026-03-04**

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
- auth gate + onboarding redirect in root routing
- onboarding data persisted to `public.profiles`
- global header shortcut keeps settings/user-space reachable on authenticated app screens
- settings flows:
  - edit profile
  - subscription placeholder
  - sign out
  - delete account
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

## In Progress

- end-to-end production validation of full auth/recovery flow on physical devices
- payment provider integration (webhook currently scaffolded)
- stronger automated integration coverage

## Planned Next

- integrate billing provider (RevenueCat/Stripe decision path)
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
```

Manual checks:

1. Sign up -> confirmation email -> callback -> onboarding.
2. Forgot password -> recovery email -> reset password -> login succeeds.
3. Unauthenticated user is redirected to login.
4. Authenticated user without onboarding is redirected to onboarding.
5. `POST /api/claude` returns `401` without bearer token.
6. `npm run deploy:web` publishes a working web app (no white-screen bootstrap crash).

## Dependencies and Config

Required app env:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_CLAUDE_PROXY_URL`

Required backend env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- optional: `REVENUECAT_WEBHOOK_SECRET`

Supabase URL config must include:

- `hahaha://auth/callback`
- `https://www.ha-ha.ai/auth/callback`
- `https://ha-ha.ai/auth/callback`
