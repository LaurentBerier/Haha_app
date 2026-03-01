# Ha-Ha.ai (Mobile App + Claude Proxy)

Ha-Ha.ai is an Expo React Native app with Supabase authentication, profile-driven onboarding, and a secured Claude proxy on Vercel.

## Current Scope

Implemented in this repository:

- Mobile app (`src/`) with Expo Router, Zustand, strict TypeScript.
- Supabase auth integration (email/password + Apple Sign-In).
- Auth gate and onboarding flow in app routing.
- Settings flow (profile edit, subscription stub, sign out, account deletion).
- User profile model and profile personalization injection in system prompts.
- Claude proxy (`api/claude.js`) with JWT validation via Supabase service role.
- Admin endpoint (`api/admin-account-type.js`) for account type assignment.
- Account deletion endpoint (`api/delete-account.js`).
- Payment webhook scaffold (`api/payment-webhook.js`) for tier sync from billing events.
- Extensible account type model (`free`, `regular`, `premium`, `admin`, plus custom).

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
- `EXPO_PUBLIC_ANTHROPIC_MODEL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Notes:

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` should use Supabase publishable/anon public key.
- These are public client vars; they are not server secrets.

### Vercel backend vars

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, required for JWT/user validation)
- `REVENUECAT_WEBHOOK_SECRET` (required in production if using `api/payment-webhook.js`)
- Optional: `ALLOWED_ORIGINS`

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
- `/(auth)/onboarding`
- `/auth/callback`
- `/settings`
- `/settings/edit-profile`
- `/settings/subscription`

Behavior:

- Unauthenticated users are redirected to login.
- Authenticated users without completed/skipped onboarding are redirected to onboarding.
- Onboarding completion writes profile data to Supabase.

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

## Run

```bash
# Start Expo dev server
npm run start

# Launch simulator build
npm run ios

# Install/run on connected physical device (Debug, Metro required)
npx expo run:ios --device

# Install/run Release build on device (bundled JS, Metro not required)
npx expo run:ios --device --configuration Release
```

## Verify

```bash
npm run typecheck
npm run lint
```

## Deploy to Vercel

```bash
npx vercel --prod --yes
```

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
- `docs/phase1-status.md`
- `docs/troubleshooting.md`
