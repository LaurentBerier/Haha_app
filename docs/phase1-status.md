# Phase 1 Status

## Implemented

- Expo project with strict TypeScript.
- Expo Router screens:
  - home
  - chat by conversation id
  - settings
- Domain models for artist, message, conversation, subscription, usage, persistence.
- Zustand multi-slice store and selectors.
- Dynamic personality prompt assembly service.
- Mock token streaming service.
- Chat orchestration with queued stream handling, safe token appends, cancellation guards, and unmount cleanup.
- Structured chat validation errors (`ChatError`) surfaced from hook to UI.
- i18n layer (`fr-CA` and `en-CA` dictionaries).
- Theme tokens and reusable components.
- Hybrid persistence and startup hydration (`AsyncStorage` + `SecureStore`).
- Persistence runtime validation + backward-compatible message-shape normalization during hydration.
- Input validation with inline chat errors (max message length).
- Pagination-ready message storage shape (`MessagePage`) in Zustand + persisted snapshot.
- Detox iOS E2E suite for chat flow and persistence.

## Implemented But Stubbed

- voice service
- subscription service
- analytics service

## Not Implemented Yet

- real LLM API integration
- auth and secure token lifecycle
- voice generation/playback
- payment/subscription purchase flow
- cloud sync and multi-device data
- unit/integration test suite
- Android E2E coverage

## Quality Gates (Current)

- `npm run typecheck`: passing
- `npm run lint`: passing
- iOS build: passing
- `npm run e2e:ios`: passing

## Notes

- Native `ios/` directory exists due to `expo run:ios` prebuild.
- Dependency versions were aligned to Expo SDK 53 compatibility during integration.
