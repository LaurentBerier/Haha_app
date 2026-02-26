# Phase 1 Status

## Implemented

- Expo project with strict TypeScript.
- Expo Router screens:
  - home
  - chat by conversation id
  - settings
- Domain models for artist, message, conversation, subscription, usage, persistence.
- Zustand multi-slice store and selectors.
- Dynamic personality system prompt assembly service (`personalityEngineService.ts`).
- Live Claude API service (`claudeApiService.ts`) with runtime-compatible streaming/non-stream handling.
- Mock token streaming service retained as fallback and offline path.
- Claude-to-mock runtime fallback on generation failures (resilience path without feature flag toggle).
- Chat orchestration with queued stream handling, safe token appends, cancellation guards, and unmount cleanup.
- Structured chat validation errors (`ChatError`) surfaced from hook to UI.
- i18n layer (`fr-CA` and `en-CA` dictionaries).
- Theme tokens and reusable components.
- Mode selection UX (home -> mode-select -> chat).
- Scrollable mode selection list for large mode catalogs.
- Auto-scroll to latest message while preserving manual scroll position when user scrolls up.
- XLSX import pipeline for modes/few-shots (`npm run import:modes`).
- Hybrid persistence and startup hydration (`AsyncStorage` + `SecureStore`).
- Conversation-level mode persistence (`conversation.modeId`).
- Persistence runtime validation + backward-compatible message-shape normalization during hydration.
- Input validation with inline chat errors (max message length).
- Pagination-ready message storage shape (`MessagePage`) in Zustand + persisted snapshot.
- Detox iOS E2E suite for chat flow and persistence.
- Mode few-shot robustness improvements:
  - dedicated `radar-attitude` few-shots
  - global few-shot fallback when a mode has no dedicated examples
  - recency-aware mock response selection per mode

## Implemented But Stubbed

- voice service
- subscription service
- analytics service

## Not Implemented Yet

- secure backend proxy for Anthropic key management
- auth and secure token lifecycle
- voice generation/playback
- payment/subscription purchase flow
- cloud sync and multi-device data
- unit/integration test suite
- Android E2E coverage
- automatic mode switching implementation for `radar-attitude`

## Quality Gates (Current)

- `npm run typecheck`: passing
- `npm run lint`: passing
- iOS build: passing
- `npm run e2e:ios`: passing

## Notes

- Native `ios/` directory exists due to `expo run:ios` prebuild.
- Dependency versions were aligned to Expo SDK 53 compatibility during integration.
