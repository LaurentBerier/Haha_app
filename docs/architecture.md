# Architecture

## Scope

Phase 1 implements text chat with one artist and mock streaming, while preserving multi-artist-ready architecture.

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

## Chat Flow

Hook: `src/hooks/useChat.ts`

1. Validate input and conversation id.
2. Enforce max input length (`MAX_MESSAGE_LENGTH`) and return structured `ChatError` when invalid.
3. Add user message (`complete`).
4. Add placeholder artist message (`pending`).
5. Assemble prompt from artist profile + history.
6. Queue stream jobs (prevents overlapping streams on rapid sends).
7. Stream tokens into placeholder via `appendMessageContent` (`streaming`).
8. Complete with usage metadata (`complete`) or mark error (`error`).

Unmount behavior:

- Cancels active stream.
- Marks active and queued artist messages as `error`.
- Guards against stale token writes after cancellation/conversation changes.

## Personality Engine

File: `src/services/personalityEngine.ts`

- Pure prompt assembly function.
- Deterministic block composition.
- Reads artist profile + history + user input + language + optional context signals.
- No network side effects.

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
- `personalityEngine.ts`
- `persistenceService.ts`

Stubs for later phases:

- `voiceEngine.ts`
- `subscriptionService.ts`
- `analyticsService.ts`
