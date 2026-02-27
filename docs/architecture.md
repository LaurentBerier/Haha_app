# Architecture

## Scope

Phase 1 implements chat with one artist (text + optional user image attachment) and dual backend execution:

- live Claude proxy path (`EXPO_PUBLIC_CLAUDE_PROXY_URL`)
- local mock fallback path

Architecture remains multi-artist-ready.

## Folder Map

- `src/app`: route-level screens (Expo Router)
- `src/components`: presentational UI pieces
- `src/hooks`: orchestration logic for UI flows
- `src/services`: business logic + integrations
- `src/store`: Zustand slices and merged store
- `src/models`: domain interfaces/types
- `src/config`: seed data/constants/flags
- `src/i18n`: localization dictionaries
- `src/theme`: styling tokens
- `src/config/artistAssets.ts`: static artist avatar source mapping
- `src/types/assets.d.ts`: TypeScript image module declarations (`png/jpg/jpeg`)
- `src/components/common/AmbientGlow.tsx`: animated menu background glow layer

Env loading note:

- `src/config/env.ts` reads Expo public vars via direct `process.env.EXPO_PUBLIC_*`.
- This is required so Expo can inline env values in production bundles.

## State Design

Store entrypoint: `src/store/useStore.ts`

Slices:

- `artistSlice`
- `conversationSlice`
- `messageSlice`
- `subscriptionSlice`
- `artistAccessSlice`
- `usageSlice`
- `uiSlice`

Message storage:

- `messagesByConversation: Record<string, MessagePage>`
- `MessagePage` fields:
  - `messages`
  - `hasMore`
  - `cursor`
- Phase 1 values are currently `hasMore: false` and `cursor: null`, but the shape is ready for backward pagination in Phase 2.

Persistence helpers were added in store root:

- `hydrateStore(snapshot)`
- `markHydrated()`
- `hasHydrated`
- `selectPersistedSnapshot(state)`
- `conversationSlice` enforces a cap of 50 conversations per artist (FIFO: oldest removed first).


## Mode System

Core files:

- `src/models/Mode.ts`
- `src/config/modes.ts` (generated)
- `src/data/cathy-gauthier/modeFewShots.ts` (generated)
- `src/app/mode-select/[artistId].tsx`
- `src/app/history/[artistId].tsx`

Behavior:

- User selects artist on home screen by tapping the visual artist selector (photo or label zone).
- Home artist card is a single press target (`artist-start-<id>`) without a secondary CTA button.
- Home keeps only essential information (avatar + artist name + short genre line), with no helper hint copy and no language row.
- Mode selector is rendered with `FlatList` to support long mode catalogs.
- Home and mode-select screens render an animated ambient glow layer behind content (pointer-events disabled).
- Ambient glow motion uses continuous 360-degree linear rotation (no ping-pong) with depth-parallax layers at different speeds.
- Glow visuals use large multi-layer orbs, high-radius halo shadows, and animated pulse to simulate strong blurred light.
- Selecting any non-history mode always creates a new conversation with `modeId`.
- Mode list appends a dedicated `history` card (`kind: history`) that routes to `/history/[artistId]`.
- History screen lists the 20 most recently updated conversations for the artist and resumes an existing chat on tap.
- `useChat` resolves active mode and dedicated mode few-shots.
- If a mode has no dedicated few-shots, `useChat` falls back to `getAllCathyFewShots()`.
- Mock path uses mode few-shots for response selection and recency filtering.
- Live path uses mode id to build system instructions (`personalityEngineService.ts` + `modePrompts.ts`).
- Mode card emoji selection uses explicit per-mode mapping plus deterministic fallback for unknown/new mode ids.

## Chat Flow

Hook: `src/hooks/useChat.ts`

1. Validate input and conversation id.
2. Enforce max input length (`MAX_MESSAGE_LENGTH`) and return structured `ChatError` when invalid.
3. Resolve active conversation mode (`modeId`) and associated mode few-shots.
4. Resolve language for the turn (`conversation.language`) and auto-switch to `en-CA` when user text is detected as mostly English.
5. Capture conversation history snapshot before appending the new user turn.
6. Add user message (`complete`).
7. Add placeholder artist message (`pending`).
8. Build `systemPrompt` (`buildSystemPrompt(modeId)`) and queue stream job (prevents overlapping streams on rapid sends).
9. User turn payload supports text-only or text+image (single image attachment from chat `+` button).
10. Choose execution path:
   - `USE_MOCK_LLM=true` -> `streamMockReply`
   - `USE_MOCK_LLM=false` -> `streamClaudeResponse`
   - If Claude fails before completion, hook retries the same turn with `streamMockReply` automatically while preserving any already-streamed content.
   - This fallback is resilience behavior, so apparent "dumb" replies can indicate live Claude path failures.
11. Stream/append text into placeholder via `appendMessageContent` (`streaming`).
12. Complete with usage metadata (`complete`) or mark error (`error`).

Why history snapshot matters:

- Prevents sending the same user input twice to Claude for one turn.

Unmount behavior:

- Cancels active stream.
- Marks active and queued artist messages as `error`.
- Guards against stale token writes after cancellation/conversation changes.

Message list behavior:

- Conversation uses `FlatList`.
- On first render and new tokens/messages, UI auto-scrolls to latest when user is near bottom.
- If user scrolls up to read history, auto-scroll pauses until user returns near the bottom.

Visual system notes:

- Phase 1 UI now uses a denser spacing/typography scale for a more compact layout.
- Cathy launch image asset is loaded from local bundle (`CathyGauthier.jpg`) through `artistAssets.ts`.

## Personality Engine

Files:

- `src/services/personalityEngineService.ts` (active in chat flow)
- `src/services/personalityEngine.ts` (legacy prompt assembler retained)

Current active engine:

- Assembles system prompt from Cathy blueprint + mode-specific prompt rules.
- Formats conversation history into Anthropic-compatible role/content messages.
- Adds `[Image partagée]` marker when formatting completed history containing user image messages.
- No network side effects.

Live transport:

- `src/services/claudeApiService.ts`
- Calls app-configured proxy URL (`EXPO_PUBLIC_CLAUDE_PROXY_URL`) instead of Anthropic directly from the client.
- Proxy endpoint (`api/claude.js`) holds `ANTHROPIC_API_KEY` server-side and forwards validated requests to Anthropic Messages API (`/v1/messages`).
- Proxy validates multimodal content blocks (text + image), restricts image media types, and enforces max image size before forwarding upstream.
- React Native runtime uses non-stream fallback for compatibility.
- Non-RN runtime uses SSE stream parsing.

## Persistence

Files:

- `src/services/persistenceService.ts`
- `src/hooks/useStorePersistence.ts`

Behavior:

- Load snapshot at startup.
- Hydrate store once.
- Subscribe to store and save snapshot with debounce (`500ms`).
- Non-sensitive fields saved to `AsyncStorage`.
- Sensitive fields (`subscription`, `unlockedArtistIds`) saved to `SecureStore`.
- Load uses `Promise.allSettled` to tolerate SecureStore failures without crashing hydration.
- Save uses `Promise.allSettled` to avoid dropping successful writes when one storage backend fails.
- Load path includes runtime validation/normalization and falls back safely on malformed persisted payloads.

## E2E Testing

- Runner: Detox + Jest (`.detoxrc.js`, `e2e/jest.config.js`, `e2e/init.js`)
- Scope:
  - chat streaming flow
  - background/relaunch during streaming
  - persistence across relaunch

## i18n and Theme

- i18n dictionaries: `src/i18n/fr.ts`, `src/i18n/en.ts`
- resolver: `src/i18n/index.ts`
- default app language is `fr-CA` (from `APP_DEFAULT_LANGUAGE`)
- conversation language auto-switches FR -> EN when a user message is detected as English
- new conversations prefer current app language when supported by the artist
- theme tokens: `src/theme/*`

## Services

Implemented:

- `mockLlmService.ts`
- `personalityEngineService.ts`
- `claudeApiService.ts`
- `persistenceService.ts`
- `voiceEngine.ts` (speech-to-text permission/start/stop orchestration)

Retained for compatibility:

- `personalityEngine.ts`

Stubs for later phases:

- voice synthesis/playback path in `voiceEngine.ts`
- `subscriptionService.ts`
- `analyticsService.ts`
