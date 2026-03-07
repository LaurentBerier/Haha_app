# Ha-Ha.ai (Mobile App + Claude Proxy)

Ha-Ha.ai is an Expo React Native app with Supabase authentication, profile-driven onboarding, and a secured Claude proxy on Vercel.

## Current Scope

Implemented in this repository:

- Mobile app (`src/`) with Expo Router, Zustand, strict TypeScript.
- Supabase auth integration (email/password + Apple Sign-In).
- Auth gate and onboarding flow in app routing.
- Settings flow (profile edit, language/display preferences, subscription provider scaffold, sign out, account deletion).
- Unified app-style top bar (logo + hamburger menu) across mobile/web app screens.
- Paid-tier voice strategy currently targets ElevenLabs.
- User profile model and profile personalization injection in system prompts.
- Claude proxy (`api/claude.js`) with JWT validation via Supabase service role.
- Admin endpoint (`api/admin-account-type.js`) for account type assignment.
- Account deletion endpoint (`api/delete-account.js`).
- Payment webhook scaffold (`api/payment-webhook.js`) for tier sync from billing events.
- Shared API utilities (`api/_utils.js`) for CORS, bearer token extraction, request IDs, env checks, and standardized errors.
- Extensible account type model (`free`, `regular`, `premium`, `admin`, plus custom).
- Unit test baseline (Jest) for API security contracts and core store slices.
- Web integration target: website repo (`ha-ha.ai`) routes `/app*` into this app's Expo web build.

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

Notes:

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` should use Supabase publishable/anon public key.
- These are public client vars; they are not server secrets.
- `EXPO_PUBLIC_USE_MOCK_LLM` defaults to `false` and should stay disabled in production.
- Current default Claude model: `claude-sonnet-4-6`.

### Vercel backend vars

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, required for JWT/user validation)
- `REVENUECAT_WEBHOOK_SECRET` (required if using `api/payment-webhook.js`; endpoint fails closed when missing)
- `ALLOWED_ORIGINS` (required for browser callers that send `Origin`; comma-separated allowlist)
- `CLAUDE_RATE_LIMIT_MAX_REQUESTS` (optional, default `30`, per user)
- `CLAUDE_RATE_LIMIT_WINDOW_MS` (optional, default `60000`)
- `ANTHROPIC_FETCH_TIMEOUT_MS` (optional, default `25000`)

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

## App Auth Flow

Routes:

- `/(auth)/login`
- `/(auth)/signup`
- `/(auth)/forgot-password`
- `/(auth)/reset-password`
- `/(auth)/onboarding`
- `/auth/callback`
- `/settings`
- `/settings/edit-profile`
- `/settings/subscription`

Behavior:

- Unauthenticated users are redirected to login.
- Authenticated users without completed/skipped onboarding are redirected to onboarding.
- Onboarding completion writes profile data to Supabase.
- Signup confirmation screen instructs users to check spam/junk for Ha-Ha.ai confirmation emails.
- Password recovery links (`flow=recovery`) are handled by `/auth/callback` and routed to `/(auth)/reset-password`.
- Expired/invalid callback links now show a recovery screen with explicit actions to either sign in (resume onboarding) or restart signup.
- `Paramètres` (`/settings`) stays reachable from authenticated screens via header shortcut.
- Header logo returns to artist selection (`/`) and hamburger menu includes account routes plus auth action (sign in/sign up/sign out depending on state).

Supabase URL configuration should include:

- `hahaha://auth/callback`
- `https://www.ha-ha.ai/auth/callback`
- `https://ha-ha.ai/auth/callback`

## Account Types and Admin

Account type registry:

- `src/config/accountTypes.ts`

Admin endpoint:

- `POST /api/admin-account-type`
- File: `api/admin-account-type.js`

Auth requirements:

- Bearer JWT from Supabase user with `app_metadata.role='admin'` or `app_metadata.account_type='admin'`

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
- Rejects invalid/missing token with `401`
- Enforces server-side model whitelist (only approved models are accepted)
- Enforces server-side per-user rate limit using `public.usage_events`
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

## Payment Webhook Scaffold

Endpoint:

- `POST /api/payment-webhook`

Notes:

- Designed for RevenueCat-style payloads.
- Persists incoming events in `public.payment_events`.
- Maps product IDs to account types, updates `profiles.account_type_id`, and syncs JWT metadata.
- Fails closed in every environment when `REVENUECAT_WEBHOOK_SECRET` is missing.

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

## Deploy to Vercel

```bash
npx vercel --prod --yes
```

Deploy web app static build (recommended in separate Vercel project, e.g. `haha-app-web`):

```bash
npm run deploy:web
```

This command:

- exports Expo web to `dist-web`
- patches `dist-web/index.html` to load JS as module
- writes `dist-web/vercel.web.json` (SPA fallback)
- links `dist-web` to Vercel project `haha-app-web`
- deploys `dist-web` to Vercel production

After deployment, set this URL in the website repo (`ha-ha.ai`) as:

- `VITE_HAHA_APP_WEB_URL=https://<your-haha-app-web-domain>`

Important behavior:

- when redirected from `www.ha-ha.ai` to `haha-app-web.vercel.app`, the browser origin changes
- Supabase session storage is origin-scoped, so user may need to sign in again on first arrival
- to reduce this friction, use a stable custom domain for the app web project and keep it consistent

Current `.vercelignore` intentionally includes:

- `api/**`
- `vercel.json`
- `package.json`
- `package-lock.json`

This is required so function dependencies (for example `@supabase/supabase-js`) are available at runtime.

## Repo Layout

- Mobile app: `src/`
- Serverless API: `api/`
- Docs: `docs/`
- iOS native project: `ios/`

## Additional Docs

- `docs/architecture.md`
- `docs/economics.md`
- `docs/phase1-status.md`
- `docs/phase2-status.md`
- `docs/troubleshooting.md`
- `ha-ha-ai-build-prompt.improved.md`
