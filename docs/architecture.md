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
- Auth routes:
  - `/(auth)/login`
  - `/(auth)/signup`
  - `/(auth)/forgot-password`
  - `/(auth)/reset-password`
  - `/(auth)/onboarding`
- Auth callback route:
  - `/auth/callback` (handles signup + recovery links)
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
- `persistenceService.ts`: local cache persistence (conversations/messages/ui selections)

### Hooks (`src/hooks`)

- `useAuth`: bootstraps stored session + subscribes to Supabase auth changes
- `useChat`: handles prompt build + Claude proxy orchestration
- `useStorePersistence`: hydration/debounced persistence

## Backend Endpoints (`api`)

### `POST /api/claude` (`api/claude.js`)

- CORS handling
- Bearer token validation via Supabase admin API
- payload validation
- forwards request to Anthropic API

### `POST /api/admin-account-type` (`api/admin-account-type.js`)

- admin-only bearer token check
- validates target account type
- updates `profiles.account_type_id`
- syncs `auth.users.app_metadata` (`account_type`, `role`)

### `POST /api/delete-account` (`api/delete-account.js`)

- validates bearer token
- deletes authenticated Supabase user with admin API
- relies on DB cascade (`ON DELETE CASCADE`) for related records

### `POST /api/payment-webhook` (`api/payment-webhook.js`)

- validates webhook auth in production (`REVENUECAT_WEBHOOK_SECRET`)
- stores events in `payment_events`
- maps products to account types
- updates profile tier + metadata claims

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

`subscriptionSlice` evaluates access via rank/permissions from this registry.

## Persistence Strategy

Persisted locally:

- selected artist
- conversations
- messages
- active conversation id

Not persisted locally:

- Supabase auth session (managed by Supabase SDK)
- server-sourced account type truth

## Prompt Personalization

`buildSystemPrompt(modeId, userProfile)` appends `## PROFIL UTILISATEUR` when profile data exists.

## Deployment Notes

Vercel functions require project dependencies at runtime; `.vercelignore` must include:

- `!package.json`
- `!package-lock.json`

## Cross-Repo Web Integration

The website repo (`ha-ha.ai`) keeps the landing/auth experience and bridges `/app*` routes to this Expo app's web build URL (configured there via `VITE_HAHA_APP_WEB_URL`).
