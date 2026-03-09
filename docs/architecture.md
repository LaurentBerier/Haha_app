# Architecture

## Overview

This repository contains:

- Expo React Native mobile app (`src/`)
- Vercel serverless backend endpoints (`api/`)

Supabase is the source of truth for:

- authentication
- user profile data
- account type / entitlement data

## Mobile App

### Routing (`src/app`)

- Root layout (`_layout.tsx`): hydration, error boundary, auth/onboarding gate
- Root layout also owns the global app top bar (brand logo left, screen title center, hamburger menu right) and account menu overlay for authenticated users.
- Root layout supports an E2E-only auth bypass gate via `EXPO_PUBLIC_E2E_AUTH_BYPASS=true`.
- Home route (`/`) intentionally uses an empty center title for a cleaner artist-selection header.
- Chat route dynamically sets the center title to active mode (`emoji + mode name`).
- Universal `BackButton` is used on secondary routes (`mode-select`, `history`, `chat`, `settings`, `edit-profile`, `subscription`).
- Header logo always routes to `/` (artist selection); back navigation remains a separate action.
- Auth routes:
  - `/(auth)/login`
  - `/(auth)/signup`
  - `/(auth)/forgot-password`
  - `/(auth)/reset-password`
  - `/(auth)/onboarding`
- Auth callback route:
  - `/auth/callback` (handles signup + recovery links, detects expired/invalid links, and renders resume/restart actions)
- Main app routes:
  - `/`
  - `/mode-select/[artistId]`
  - `/chat/[conversationId]`
  - `/history/[artistId]`
  - `/settings`
  - `/settings/edit-profile`
  - `/settings/subscription`

### State (`src/store`)

Root store: `src/store/useStore.ts`

Active slices:

- `artistSlice`
- `artistAccessSlice`
- `authSlice`
- `conversationSlice`
- `messageSlice`
- `subscriptionSlice`
- `uiSlice`
- `usageSlice`
- `userProfileSlice`

Store-level account isolation:

- persisted snapshot includes `ownerUserId`
- when authenticated user changes, account-scoped chat state is cleared (`conversations`, `messagesByConversation`, active conversation)
- message pages include `messageIndexById` for lower-cost streaming updates

### Services (`src/services`)

- `supabaseClient.ts`: Supabase client initialization (AsyncStorage session persistence)
- `authService.ts`:
  - `signInWithEmail`
  - `signUpWithEmail`
  - `signInWithApple`
  - `requestPasswordReset`
  - `updatePassword`
  - `signOut`
  - `getStoredSession`
  - `refreshSession`
  - `onAuthStateChange`
- `profileService.ts`: fetch/update profile, onboarding complete/skip
- `claudeApiService.ts`: proxy calls with Bearer token
- `personalityEngineService.ts`: prompt generation + profile personalization
- `artistPromptRegistry.ts`: artist-aware blueprint/mode prompt resolution (Cathy + fallback artists)
- `subscriptionService.ts`: Stripe checkout launcher (regular/premium), subscription summary fetch, and cancel-at-period-end action
- `persistenceService.ts`: local cache persistence (conversations/messages/ui selections)

### Hooks (`src/hooks`)

- `useAuth`: bootstraps stored session, hydrates usage quota from `/api/usage-summary`, and subscribes to Supabase auth changes
- `useChat`: queue-driven streaming orchestration, retry support, and route-safe stream cleanup
- `useStorePersistence`: hydration/debounced persistence

## Backend Endpoints (`api`)

### `POST /api/claude` (`api/claude.js`)

- CORS allowlist handling via shared `api/_utils.js` (`ALLOWED_ORIGINS`)
- Bearer token validation via Supabase admin API
- server-side prompt-context validation (`artistId`, `modeId`, `language`)
- server-side system prompt assembly (artist blueprint + mode + user profile)
- strict server-side model whitelist
- server-side monthly quota by tier (env-overridable caps)
- server-side per-user rate limiting backed by `public.usage_events`
- optional single-RPC limits path (`public.enforce_claude_limits`) via `CLAUDE_LIMITS_RPC=true`
- short-lived monthly quota cache + graceful in-memory rate-limit fallback when DB usage store is unavailable
- payload validation
- forwards request to Anthropic API
- upstream timeout protection with `AbortController`
- `X-Request-Id` response header for tracing
- standardized error payload `{ error: { message, code, requestId } }`

### `POST /api/admin-account-type` (`api/admin-account-type.js`)

- admin-only bearer token check
- validates target account type
- updates `profiles.account_type_id`
- syncs `auth.users.app_metadata.account_type` while preserving existing metadata fields
- `accountTypeId='admin'` is blocked unless `ENABLE_ADMIN_TIER_GRANTS=true`
- writes best-effort audit row (`audit_logs`) for account-type changes
- shared CORS/auth/error/request-id utilities

### `POST /api/delete-account` (`api/delete-account.js`)

- validates bearer token
- deletes authenticated Supabase user with admin API
- relies on DB cascade (`ON DELETE CASCADE`) for related records
- shared CORS/auth/error/request-id utilities

### `POST /api/payment-webhook` (`api/payment-webhook.js`)

- validates webhook auth in all environments (`REVENUECAT_WEBHOOK_SECRET`)
- constant-time secret comparison (`timingSafeEqual`)
- stores events in `payment_events`
- duplicate-event guard using provider event identifiers
- maps products to account types
- updates profile tier + metadata claims
- writes best-effort audit rows (`audit_logs`)

### `POST /api/stripe-webhook` (`api/stripe-webhook.js`)

- verifies `Stripe-Signature` using `STRIPE_WEBHOOK_SECRET`
- verification uses official Stripe SDK `constructEvent(...)` on strict raw request body
- supports `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- stores events in `payment_events`
- persists Stripe customer/subscription mapping in `stripe_customer_links`
- updates profile tier + metadata claims
- writes best-effort audit rows (`audit_logs`)

### `GET /api/usage-summary` (`api/usage-summary.js`)

- validates bearer token via Supabase admin API
- returns monthly usage snapshot for current user:
  - `messagesUsed`
  - `messagesCap` (`null` for `admin`)
  - `resetDate` (UTC next month start)

### `GET /api/subscription-summary` (`api/subscription-summary.js`)

- validates bearer token via Supabase admin API
- resolves Stripe subscription link from `stripe_customer_links`
- fetches current Stripe subscription status (when linked) using `STRIPE_SECRET_KEY`
- returns current billing state for the app subscription screen

### `POST /api/subscription-cancel` (`api/subscription-cancel.js`)

- validates bearer token via Supabase admin API
- resolves Stripe subscription from `stripe_customer_links`
- updates Stripe subscription with `cancel_at_period_end=true`
- returns updated cancellation/billing metadata

## Auth and Profile Model

### Session/User (`src/models/AuthUser.ts`)

`AuthUser` exposes:

- `id`
- `email`
- `displayName`
- `avatarUrl`
- `role`
- `accountType`
- `createdAt`

`AuthSession` wraps `user`, access/refresh token, expiry.

Signup confirmation UX:

- after signup, app shows explicit "check your email" confirmation text
- confirmation screen reminds users to check spam/junk for Ha-Ha.ai email
- callback route handles stale links without dead-end loops by offering:
  - sign in to resume onboarding
  - restart signup

### Profile (`src/models/UserProfile.ts`)

`UserProfile` fields:

- `id`
- `age`
- `sex`
- `relationshipStatus`
- `horoscopeSign`
- `interests`
- `onboardingCompleted`
- `onboardingSkipped`

## Account Type and Feature Gating

Registry: `src/config/accountTypes.ts`

Built-in tiers:

- `free`
- `regular`
- `premium`
- `admin`

`subscriptionSlice` evaluates access via `session.user.accountType` (authoritative JWT claim) and rank/permissions from this registry.

## Billing and Voice Strategy

- Paid tiers (`regular`, `premium`) currently target an ElevenLabs voice path.
- Stripe checkout is configured with per-plan links (`regular`, `premium`) in client env vars.
- Subscription UX is plan-first (`Gratuit`, `Régulier`, `Premium`) with factual perk summaries and direct plan CTAs.
- Artist pool share is modeled at a fixed `15%` across paid tiers.
- PayPal/Apple checkout URLs exist as optional placeholders in env but are not fully wired server-side yet.

## Persistence Strategy

Persisted locally:

- owner user id for account-scoped cache safety
- selected artist
- conversations
- messages
- active conversation id
- UI preferences (`language`, `displayMode`, `reduceMotion`)

Not persisted locally:

- Supabase auth session (managed by Supabase SDK)
- server-sourced account type truth

## Prompt Personalization

`buildSystemPromptForArtist(artistId, modeId, userProfile, language)` appends profile context only when profile data exists and adapts labels to FR/EN.

## Deployment Notes

Vercel functions require project dependencies at runtime; `.vercelignore` must include:

- `!package.json`
- `!package-lock.json`

## Unit Tests

- Jest unit config: `jest.unit.config.cjs`
- API tests: `api/__tests__/`
- Store slice tests: `src/store/slices/*.test.ts`
- Command: `npm run test:unit`

## Cross-Repo Web Integration

The website repo (`ha-ha.ai`) keeps the marketing landing page and bridges `/app*` routes to this Expo app's web build URL (configured there via `VITE_HAHA_APP_WEB_URL`).

Web bridge mapping:

- `/app` -> `HAHA_app` web `/`
- `/app/chat/cathy-gauthier` -> `HAHA_app` web `/mode-select/cathy-gauthier`
- `/app/account` -> `HAHA_app` web `/settings`

## Web Build Pipeline (`HAHA_app`)

Scripts:

- `npm run export:web`:
  - runs Expo web export into `dist-web`
  - patches exported `index.html` script tag to `type="module"` for browser compatibility
  - writes `dist-web/vercel.web.json` for SPA fallback on Vercel
- `npm run deploy:web`:
  - calls `export:web`
  - links `dist-web` to Vercel project `haha-app-web`
  - deploys production static build
