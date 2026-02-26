# Architecture

## Scope

Phase 1 implements text chat with one artist and dual backend execution:

- live Claude API path
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


## Mode System

Core files:

- `src/models/Mode.ts`
- `src/config/modes.ts` (generated)
- `src/data/cathy-gauthier/modeFewShots.ts` (generated)
- `src/app/mode-select/[artistId].tsx`

Behavior:

- User selects artist on home screen, then selects mode on mode-select screen.
- Mode selector is rendered with `FlatList` to support long mode catalogs.
- Conversation is created with `modeId`.
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
4. Capture conversation history snapshot before appending the new user turn.
5. Add user message (`complete`).
6. Add placeholder artist message (`pending`).
7. Build `systemPrompt` (`buildSystemPrompt(modeId)`) and queue stream job (prevents overlapping streams on rapid sends).
8. Choose execution path:
   - `USE_MOCK_LLM=true` -> `streamMockReply`
   - `USE_MOCK_LLM=false` -> `streamClaudeResponse`
   - If Claude fails before completion, hook retries the same turn with `streamMockReply` automatically.
   - During fallback retry, placeholder content is reset and status returns to `pending`.
9. Stream/append text into placeholder via `appendMessageContent` (`streaming`).
10. Complete with usage metadata (`complete`) or mark error (`error`).

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

## Personality Engine

Files:

- `src/services/personalityEngineService.ts` (active in chat flow)
- `src/services/personalityEngine.ts` (legacy prompt assembler retained)

Current active engine:

- Assembles system prompt from Cathy blueprint + mode-specific prompt rules.
- Formats conversation history into Anthropic-compatible role/content messages.
- No network side effects.

Live transport:

- `src/services/claudeApiService.ts`
- Uses Anthropic Messages API (`/v1/messages`).
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
- theme tokens: `src/theme/*`

## Services

Implemented:

- `mockLlmService.ts`
- `personalityEngineService.ts`
- `claudeApiService.ts`
- `persistenceService.ts`

Retained for compatibility:

- `personalityEngine.ts`

Stubs for later phases:

- `voiceEngine.ts`
- `subscriptionService.ts`
- `analyticsService.ts`
