# Phase 1 Status

## Implemented

- Expo project with strict TypeScript.
- Expo Router screens:
  - home
  - mode-select by artist id
  - history by artist id
  - chat by conversation id
  - settings
- Domain models for artist, message, conversation, subscription, usage, persistence.
- Zustand multi-slice store and selectors.
- Dynamic personality system prompt assembly service (`personalityEngineService.ts`).
- Live Claude proxy client service (`claudeApiService.ts`) with runtime-compatible streaming/non-stream handling.
- Serverless backend proxy endpoint (`api/claude.js`) for secure Anthropic key handling.
- Mock token streaming service retained as fallback and offline path.
- Claude-to-mock runtime fallback on generation failures (resilience path without feature flag toggle).
- Chat orchestration with queued stream handling, safe token appends, cancellation guards, and unmount cleanup.
- Duplicate-turn prevention in live Claude path (history snapshot before current user message append).
- Structured chat validation errors (`ChatError`) surfaced from hook to UI.
- Voice-to-text input flow with mic/stop controls, permissions handling, and transcript insertion into chat input.
- Dark chat composer redesign with `+` button, integrated mic, and right-side action button.
- User image attachment flow (`expo-image-picker`): gallery pick, inline preview/remove, and send with message.
- Multimodal Claude proxy support for image+text user turns with server-side validation.
- i18n layer (`fr-CA` and `en-CA` dictionaries).
- Default app language set to `fr-CA` with per-message FR -> EN auto-switch detection when user writes in English.
- Theme tokens and reusable components.
- Refined compact visual theme (spacing/typography/colors) for denser, modern UI.
- Mode selection UX (home -> mode-select -> chat).
- Dedicated History mode card in mode-select opens `/history/[artistId]` and resumes existing conversations.
- Scrollable mode selection list for large mode catalogs.
- Deterministic icon fallback variety for new/unknown modes.
- Auto-scroll to latest message while preserving manual scroll position when user scrolls up.
- Home artist selection updated to visual tap target with Cathy circular photo avatar (no start button).
- Home artist selector simplified for minimal UI (avatar + name + short genre line, no helper text, no language line).
- Continuous parallax ambient light/glow effects added to artist and mode selection menus (stronger blurred glow + animated pulse).
- XLSX import pipeline for modes/few-shots (`npm run import:modes`).
- Hybrid persistence and startup hydration (`AsyncStorage` + `SecureStore`).
- Conversation-level mode persistence (`conversation.modeId`).
- Non-history mode taps always create a new conversation (no mode-based reuse).
- Conversation storage capped to 50 items per artist (FIFO eviction), with history view limited to latest 20.
- Persistence runtime validation + backward-compatible message-shape normalization during hydration.
- Input validation with inline chat errors (max message length).
- Pagination-ready message storage shape (`MessagePage`) in Zustand + persisted snapshot.
- Detox iOS E2E suite for chat flow and persistence.
- Mode few-shot robustness improvements:
  - dedicated `radar-attitude` few-shots
  - global few-shot fallback when a mode has no dedicated examples
  - recency-aware mock response selection per mode

## Implemented But Stubbed

- voice synthesis service (TTS)
- subscription service
- analytics service

## Not Implemented Yet

- proxy auth/rate limiting and abuse protection
- full discussion feature flow (current UI button shows coming-soon message)
- auth and secure token lifecycle
- voice synthesis/playback
- payment/subscription purchase flow
- cloud sync and multi-device data
- unit/integration test suite
- Android E2E coverage
- automatic mode switching implementation for `radar-attitude`

## Quality Gates (Current)

- `npm run typecheck`: passing
- `npm run lint`: passing
- `npx expo install --check`: passing
- iOS build: passing
- `npm run e2e:ios`: passing

## Notes

- Native `ios/` directory exists due to `expo run:ios` prebuild.
- Dependency versions were aligned to Expo SDK 53 compatibility during integration.
