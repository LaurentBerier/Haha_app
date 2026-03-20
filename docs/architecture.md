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
- Root layout adds web hover affordances on interactive controls (subtle glow/brightness feedback).
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
  - `/auth/callback` (handles signup + recovery links, detects expired/invalid links, renders resume/restart actions, and performs web-to-native auth-link handoff on mobile browsers)
- Main app routes:
  - `/`
  - `/mode-select/[artistId]` (category hub)
  - `/mode-select/[artistId]/[categoryId]` (category detail)
  - `/chat/[conversationId]`
  - `/history/[artistId]`
  - `/stats`
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
- `gamificationSlice`
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
  - native auth redirects are forced to `hahaha://auth/callback`; web redirects use `/auth/callback`
- `profileService.ts`: fetch/update profile, onboarding complete/skip
- `claudeApiService.ts`: proxy calls with Bearer token
- `personalityEngineService.ts`: prompt generation + profile personalization
- `artistPromptRegistry.ts`: artist-aware blueprint/mode prompt resolution (Cathy + fallback artists)
- `subscriptionService.ts`: Stripe checkout launcher (regular/premium), subscription summary fetch, and cancel-at-period-end action
- `persistenceService.ts`: local cache persistence (conversations/messages/ui selections)
- `ttsService.ts`: multi-endpoint TTS fetch/cache (`same-origin /api/tts` first on web, timeout + failover across candidates)
- `voiceEngine.ts`: session-based STT engine abstraction (web/native), restart handling, stale-session isolation

### Mode Selection UX

- Category configuration: `src/config/modeCategories.ts`
- Hub screen: `src/app/mode-select/[artistId]/index.tsx`
  - 4 animated `2x2` category buttons
  - labels: `On Jase?`, `Blagues & Gadgets`, `Jeux`, `Profil`
  - animation safety guard: category cards keep one consistent animation driver per animated node (JS driver) to avoid iOS runtime crashes when opening category subpages
- Category screen: `src/app/mode-select/[artistId]/[categoryId].tsx`
  - shows only sub-modes for selected category
  - `On Jase?` currently exposes 2 active chat modes: `On jase!` and `Mets-moi sur le grill`
  - legacy mode IDs are server-mapped for compatibility (`relax`, `roast`, `coach-brutal`, etc.)
  - `Profil` category shows profile/history shortcuts instead of chat modes

### Conversation Mode (Phase 4)

- Voice/text conversation mode is globally controlled by `uiSlice.conversationModeEnabled` (default: `true`).
- `ChatInput` is the single shared composer UI across chat contexts (chat screen + global composer + mode-select composer), including:
  - image attachment support (`+`)
  - send arrow when text/image is present
  - mic visual states driven by explicit `micState` + `hint`
  - off/paused/unsupported icon path via `assets/icons/Mic_Icon_off.png`
- Voice loop orchestration lives in `src/hooks/useVoiceConversation.ts`:
  - reducer/state-machine statuses: `off`, `starting`, `listening`, `assistant_busy`, `paused_manual`, `recovering`, `paused_recovery`, `unsupported`, `error`
  - STT/TTS mutual exclusion (`assistant_busy` while audio is active)
  - transcript auto-send after silence timeout (`1800ms`, override with `EXPO_PUBLIC_SILENCE_TIMEOUT_MS`)
  - bounded recovery policy for transient ends: `250ms`, `800ms`, `2000ms`, then `paused_recovery` until manual resume
  - manual pause always wins over auto-listen/recovery
  - web auto-listen requires explicit user activation (`hasUserActivation`), then can auto-restart when eligible
  - dedicated control API: `pauseListening()`, `resumeListening()`, `interruptAndListen()`, `armListeningActivation()`
- STT engine ownership is session-based in `src/services/voiceEngine.ts`:
  - each `startVoiceListeningSession(...)` returns a session handle with unique `sessionId`
  - `result`/`error`/`end` callbacks are ignored for stale sessions
  - web `onend` attempts local restarts (bounded) and emits terminal `onEnd` when restart budget is exhausted
- Mode-select (`/mode-select/[artistId]`) now embeds the same conversation stack directly in-screen:
  - bubbles are anchored above the bottom composer
  - no route push to `/chat/[conversationId]` when user replies in mode-select
  - navigation to a new mode/chat happens only when user chooses a mode
  - on iOS/Android, overlay top is measured from compact category-grid bottom so conversation takes maximum vertical space up to top controls
  - after several user turns, Cathy injects a one-time in-character mode-discovery nudge with optional voice playback
- Greeting behavior:
  - once per artist per app session (`uiSlice.greetedArtistIds`, memory-only)
  - greeting message is inserted as an artist message in a fresh `on-jase` conversation
  - best-effort voice playback via TTS (with web speech fallback)
  - greeting/tutorial message injection triggers one-time auto-mic arming for that `messageId` in mode-select (`armListeningActivation`)
  - manual user pause during greeting cancels forced auto-start for that greeting message
  - web localhost bypasses `/api/greeting` and uses local fallback copy to avoid local 500 noise
  - greeting API failures trigger a short client backoff before retrying
- Auto replay on return:
  - `useAutoReplayLastArtistMessage` replays only the latest replayable artist message in the current conversation
  - triggers on initial mount, `AppState=active`, web `focus`, and web `visibilitychange`
  - guarded once per `messageId` and skipped while streaming/playing/loading
- Greeting backend (`api/greeting.js`) data sources:
  - weather via Open-Meteo `/v1/forecast` (current + same-day forecast, no API key)
  - local-news signal via RSS feeds (Radio-Canada, La Presse, TVA Nouvelles)
  - in-memory cache (weather 10 min, news 30 min) and stale-fallback behavior

### Voice Rendering and Sync

- Paid-tier TTS uses ElevenLabs v3 by default (`src/server/ttsHandler.js`), with env override still supported (`ELEVENLABS_MODEL_ID`).
- Audio-expression tags are injected in Cathy prompts and preserved for TTS text.
- Display text and spoken text share the same normalization rules through `src/utils/audioTags.ts`:
  - `stripAudioTags(...)` for visible bubble text
  - `normalizeSpeechText(...)` for TTS input normalization while preserving supported audio tags
- Streaming TTS in `src/hooks/useChat.ts`:
  - queues chunk playback as soon as first URI is ready
  - appends subsequent chunks in-order without waiting for all chunks
  - keeps successful chunks when some chunk generation fails
  - performs final full-text fallback synthesis only when needed
  - stabilizes metadata transitions (`voiceStatus: generating -> ready` or explicit clear)
  - stores `voiceChunkBoundaries` for text/voice synchronization
- `useAudioPlayer` tracks playback context by `currentMessageId` so sync/playback targets are message-identity based (not URI based).
- `ChatBubble` progressively reveals text only for the active `currentMessageId`; non-active bubbles render full text.
- `WaveformButton` states:
  - `isPlaying=true` => animated waveform bars
  - `isLoading=true` => pulsing waveform
  - idle/ready => play icon for manual replay

### Games UX

- Entry point is the history banner (`src/app/history/[artistId].tsx`) -> `/games/[artistId]`
- Available games in Phase 1:
  - `Histoire improvisée` (`/games/[artistId]/impro-chain`)
  - `Vrai ou Inventé` (`/games/[artistId]/vrai-ou-invente`)
- Score bar is intentionally rendered in game screens only.

### Hooks (`src/hooks`)

- `useAuth`: bootstraps stored session, hydrates usage quota from `/api/usage-summary`, hydrates gamification stats from `/api/score`, and subscribes to Supabase auth changes
- `useChat`: queue-driven streaming orchestration, retry support, image-intent routing, mode-based score triggers, and route-safe stream cleanup
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
- soft-cap/economy degradation:
  - at soft cap (~80%): fallback model (`claude-haiku-4-5-20251001`) + reduced `max_tokens`
  - in economy mode (cap reached): reduced context window + lower token budget, while still returning responses
- `X-Quota-Mode` response header (`normal`, `soft-cap`, `economy`)
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
  - `softCapReached`
  - `economyMode`

### `POST /api/impro-themes` (`api/impro-themes.js`)

- validates bearer token via Supabase admin API
- generates personalized improv themes via Anthropic (non-streaming JSON response)
- theme request payload includes language, profile traits, nonce, and avoid-list
- client fallback path exists (local theme pool) when API generation fails
- current implementation intentionally allows theme generation to continue even when monthly chat cap is reached (cost-control caveat)

### `GET|POST /api/score` (`api/score.js`)

- validates bearer token via Supabase admin API
- `GET`: returns current gamification counters from `profiles`
- `POST`: accepts `{ action }` and applies score/counter updates
- uses SQL RPC `public.apply_score_action(...)` when available (atomic path)
- includes fallback update path for older environments where RPC is not installed yet

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
- onboarding and profile edit let the user set a preferred name used in personalized prompts

### Profile (`src/models/UserProfile.ts`)

`UserProfile` fields:

- `id`
- `preferredName`
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
- gamification counters (score, streak, stats)
- UI preferences (`language`, `reduceMotion`)

Not persisted locally:

- Supabase auth session (managed by Supabase SDK)
- server-sourced account type truth

Display mode note:

- app visual mode is intentionally dark-only; `displayMode` remains a compatibility field in store but is fixed to `dark`

## Prompt Personalization

`buildSystemPromptForArtist(artistId, modeId, userProfile, language)` appends profile context only when profile data exists and adapts labels to FR/EN.

For image-enabled chats, `imageIntent` (`photo-roast`, `meme-generator`, `screenshot-analyzer`) is passed to the backend so prompt assembly can specialize behavior even when the same mode is reused.

## Deployment Notes

Vercel functions require project dependencies at runtime; `.vercelignore` must include:

- `!package.json`
- `!package-lock.json`

## Unit Tests

- Jest unit config: `jest.unit.config.cjs`
- API tests: `api/__tests__/`
- Store slice tests: `src/store/slices/*.test.ts`
- Command: `npm run test:unit`

## Repos and Hosting Topology

Production is intentionally split across two repositories and two Vercel projects:

1. Landing repository (separate from this repo)
   - Vercel project: `ha-ha-ai`
   - Domain: `https://ha-ha.ai`
   - Responsibility: marketing/landing only

2. App repository (this repo: `HAHA_app`)
   - Vercel project: `haha-app`
   - Domain: `https://app.ha-ha.ai`
   - Responsibility: Expo web app + mobile codebase + serverless API (`/api/*`)

This replaces the previous `/app*` bridge approach. The app is now served directly on `app.ha-ha.ai`.

## Web Build Pipeline (`HAHA_app`)

Scripts:

- `npm run export:web`:
  - runs Expo web export into `dist-web`
  - patches exported `index.html` script tag to `type="module"` for browser compatibility
  - writes `dist-web/vercel.web.json` for SPA fallback on Vercel

Vercel deploys from project root using [`vercel.json`](/Users/laurentbernier/Documents/HAHA_app/vercel.json):

- `buildCommand`: `npm run export:web`
- `outputDirectory`: `dist-web`
- API functions in `api/*` deploy in the same project
