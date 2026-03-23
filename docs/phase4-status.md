# Phase 4 Status (Conversation Naturelle)

Last updated: **2026-03-23**

## Scope

Phase 4 objective is a frictionless Cathy conversation loop across app contexts:

- always-on conversation mode (voice + text) with shared UI
- reliable STT -> silence -> auto-send behavior
- robust TTS generation/playback/replay consistency
- mode-select in-place conversation (no forced route switch)
- first-session greeting/tutorial orchestration with explicit user control

## Delivered

- Global conversation-mode state in `uiSlice`:
  - `conversationModeEnabled` default `true`
  - `greetedArtistIds` (session-memory flag)
- Session-safe STT engine (`src/services/voiceEngine.ts`):
  - session handle returned for each start
  - stale session callbacks ignored
  - web `onend` restart attempts are bounded; terminal `onEnd` is emitted on exhaustion
- Voice controller refactor (`src/hooks/useVoiceConversation.ts`):
  - explicit reducer/state-machine statuses:
    - `off`, `starting`, `listening`, `assistant_busy`, `paused_manual`, `recovering`, `paused_recovery`, `unsupported`, `error`
  - silence auto-send (`1800ms`, override via `EXPO_PUBLIC_SILENCE_TIMEOUT_MS`)
  - bounded recovery policy: `250ms`, `800ms`, `2000ms`, then `paused_recovery` until user tap
  - manual pause precedence: no forced auto-resume over `paused_manual`
  - dedicated controls:
    - `pauseListening()`
    - `resumeListening()`
    - `interruptAndListen()`
    - `armListeningActivation()`
- Shared composer contract through `ChatInput`:
  - right action maps to `enable_and_listen`, `pause_listening`, `resume_listening`, or send
  - mic visuals driven by explicit `micState` + `hint`
  - off/paused/unsupported states use `Mic_Icon_off.png`
  - pause/recovery hints rendered above composer, aligned near mic/input bar
- Mode-select conversation integration (`src/app/mode-select/[artistId]/index.tsx`):
  - inline message stack above bottom composer
  - no forced route navigation for intro conversation replies
  - greeting/tutorial message injection marked by `injectedType`
  - one-time mic auto-arm after greeting/tutorial message visibility (`messageId` guard)
  - strict manual override: user pause cancels auto-start for that greeting
  - compact layout expansion: conversation overlay top anchored to compact category-grid bottom (mobile + web fallback tuning)
  - compact mode now locks background `ScrollView` and shrinks bottom spacer to avoid duplicate page-level scrollbar on web while preserving chat-list scrolling
- Forced mode nudges removed:
  - no automatic `mode_nudge` injection after N user replies
  - mode-select conversation now keeps natural flow without forced "try modes" interjections
- Tutorial-mode bound to first completed user turn only:
  - first user turn after tutorial greeting => `tutorialMode=true`
  - all following turns => `tutorialMode=false` (weather/news context allowed again)
- Cathy reaction calibration:
  - prompt now makes `[REACT:emoji]` optional and context-appropriate (not every reply)
  - client guard prevents consecutive reaction badges on back-to-back user turns
- Replay/resume reliability:
  - `useAutoReplayLastArtistMessage` replays latest replayable Cathy message on:
    - first render after hydration
    - app foreground (`AppState=active`)
    - web focus/visibility return
  - replay is once-per-message-id and current-conversation scoped
- TTS reliability hardening:
  - same-origin web candidate priority for `/api/tts` before cross-origin fallbacks
  - per-endpoint timeout with `AbortController` and failover
  - terminal statuses (`401/403/429`) stop endpoint failover and return structured error codes
  - chunk pipeline keeps successful chunks on partial failures
  - final full-text fallback synthesis when no usable chunk set remains
  - stable metadata transitions (`voiceStatus: generating -> ready` or explicit clear)
  - per-reply terminal TTS notices are deduplicated and queued after current voice settles (non-intrusive insertion)
- Typed-first-reply mic recovery fix:
  - typing while mic is active no longer leaves conversation mode stuck
  - resume intent can be queued and replayed once blocking conditions clear
- Text/voice consistency:
  - shared normalization rules in `src/utils/audioTags.ts`
  - supported emotional audio tags preserved for TTS and stripped from display text
  - unsupported bracket text preserved in display to avoid drift
- Bubble playback UX:
  - playback identity bound to `message.id` (`currentMessageId`)
  - progressive reveal only for the currently speaking message
  - waveform states:
    - `playing`: animated bars
    - `loading`: pulsing waveform
    - `idle`: play icon

## QA Status

Validated on **2026-03-23** (targeted mode-select layout pass):

- `npm run typecheck` -> PASS
- `npx eslint src/app/mode-select/[artistId]/index.tsx` -> PASS

Prior broad validation baseline remains available from **2026-03-20**:

- `npm run lint` -> PASS
- `npm run verify:profile-prompt` -> PASS
- `npm run test:unit` -> PASS (29 suites, 183 tests)
- `npm run smoke:auth` -> PASS
- `npm run smoke:voice` -> PASS (`tts with auth -> 200`)
- `npm run export:web` -> not rerun in 2026-03-20 pass (last validated 2026-03-19)
- `npm run check:mobile-env` -> not rerun in 2026-03-20 pass (last validated 2026-03-19)

Detailed run logs:

- [`docs/qa-run-2026-03-23.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-23.md)
- [`docs/qa-run-2026-03-20.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-20.md)
- [`docs/qa-run-2026-03-19.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-19.md)
- [`docs/qa-run-2026-03-18.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-18.md)
- [`docs/qa-run-2026-03-17.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-17.md)
- Latest code review snapshot: [`docs/code-review-2026-03-20.md`](/Users/laurentbernier/Documents/HAHA_app/docs/code-review-2026-03-20.md)

## Completion Status

- Phase 4 is functionally delivered for current scope (`web + iOS + API`).
- Remaining work is iterative tuning and browser-specific resilience hardening, not a foundational architecture gap.
