# Architecture

## Overview

This repository contains:

- Expo React Native mobile app (`src/`)
- Vercel serverless backend endpoints (`api/`)

Supabase is the system of record for:

- auth users
- user profiles
- account type data

## Mobile App Layers

### Routing (`src/app`)

- Root layout: hydration + auth gate + onboarding redirect
- Auth group: `/(auth)/login`, `/(auth)/signup`, `/(auth)/onboarding`
- Callback route: `/auth/callback`
- Main app routes: home, mode-select, history, chat, settings
- Settings sub-routes: `/settings/edit-profile`, `/settings/subscription`

### State (`src/store`)

Store root: `src/store/useStore.ts`

Slices:

- `artistSlice`
- `conversationSlice`
- `messageSlice`
- `subscriptionSlice`
- `artistAccessSlice`
- `usageSlice`
- `uiSlice`
- `authSlice`
- `userProfileSlice`

### Services (`src/services`)

- `supabaseClient.ts`: Supabase client with AsyncStorage auth persistence
- `authService.ts`: sign-in/up/out, session restore, auth state listener
- `profileService.ts`: profile fetch/update + onboarding complete/skip + account type lookup
- `claudeApiService.ts`: mobile client for proxy calls (+ bearer token header)
- `personalityEngineService.ts`: system prompt + profile section injection
- `persistenceService.ts`: local snapshot persistence for conversation/message cache

### Hooks (`src/hooks`)

- `useAuth`: bootstraps session from Supabase and syncs store
- `useChat`: chat orchestration, queueing, streaming/fallback
- `useStorePersistence`: hydrate/debounce-save persisted snapshot

## Backend Endpoints (`api`)

### `api/claude.js`

Responsibilities:

- CORS handling
- auth header validation via Supabase admin
- payload validation (including multimodal image content)
- relay to Anthropic Messages API

### `api/admin-account-type.js`

Responsibilities:

- admin-only bearer token validation
- validate target account type exists in `account_types`
- update `profiles.account_type_id`
- update `auth.users.app_metadata` (`account_type`, `role`)

### `api/delete-account.js`

Responsibilities:

- user bearer token validation
- authenticated user deletion via Supabase admin API
- relies on DB cascading deletes for profile-linked data

### `api/payment-webhook.js`

Responsibilities:

- webhook auth check (`REVENUECAT_WEBHOOK_SECRET` in production)
- persist raw events to `payment_events`
- map payment products to account types
- update profile tier + JWT metadata claims

## Auth and Identity Model

### Client-side user shape

`AuthUser` includes:

- `id`, `email`, `displayName`, `avatarUrl`
- `role` (from `app_metadata.role`)
- `accountType` (from `app_metadata.account_type` / user metadata fallback)

### Profile model

`UserProfile` includes:

- demographic fields
- interests
- onboarding flags

## Account Type System

Config registry:

- `src/config/accountTypes.ts`

Default types:

- `free`
- `regular`
- `premium`
- `admin`

Legacy aliases for compatibility:

- `core`
- `pro`

Feature gating in `subscriptionSlice` uses dynamic rank lookup via this registry.
The slice reads account type from authenticated session claims first, then falls back to local subscription state.

## Persistence Strategy

Persisted locally:

- selected artist
- conversations
- active conversation id
- messages by conversation

Not persisted locally:

- Supabase session (Supabase SDK storage)
- server-sourced account state intended to be hydrated from backend source of truth

## Prompt Personalization

`buildSystemPrompt(modeId, userProfile)` appends:

- `## PROFIL UTILISATEUR`

when profile fields are available. This lets generation adapt tone/references to known profile context.

## Deployment

Vercel functions depend on Node dependencies from `package.json`, so `.vercelignore` must include both:

- `package.json`
- `package-lock.json`
