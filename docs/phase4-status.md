# Phase 4 Status (Conversation Naturelle)

Last updated: **2026-04-13**

## Scope

Canonical module map (send path, auth handoff, tests): [`docs/conversation-flow-architecture.md`](conversation-flow-architecture.md).

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
  - image attachment source picker now offers explicit `library` / `camera` flows with per-source permission handling
  - heavy image attachments now pass through adaptive client optimization before send (`10MB` source cap, `<=3MB` upload payload target)
- Mode-select conversation integration (`src/app/mode-select/[artistId]/index.tsx`):
  - inline message stack above bottom composer
  - no forced route navigation for intro conversation replies
  - greeting/tutorial message injection marked by `injectedType`
  - one-time mic auto-arm after greeting/tutorial message visibility (`messageId` guard)
  - strict manual override: user pause cancels auto-start for that greeting
  - compact layout expansion: conversation overlay top anchored to compact category-grid bottom (mobile + web fallback tuning)
  - compact mode now locks background `ScrollView` and shrinks bottom spacer to avoid duplicate page-level scrollbar on web while preserving chat-list scrolling
  - deterministic binding/send targeting:
    - single `boundConversationId` drives inline mode-select render/send context
    - send-time target resolution validates live context from store, with fallback recovery to latest valid `on-jase` conversation
    - transient context mismatch returns explicit `invalidConversation` (no silent send drop)
  - render hardening for long web conversations:
    - `FlatList` keyed by bound conversation id
    - larger render window/batch sizing
    - clipping/virtualization disabled in inline overlay context
  - targeted DEV observability events for mode-select:
    - `mode_select_rebind`
    - `send_dispatched`
    - `send_result`
    - `messages_rendered`
  - greeting run lifecycle hardening:
    - each greeting cycle now owns a run token (`runId`) so stale async runs are ignored
    - `finalizeGreetingRun(...)` closes `isGreetingBooting` on all exits (success, cancellation, timeout fallback, cleanup/unmount)
    - cancelled runs that did not insert a message can reopen the cycle lock to avoid locked loading state
    - greeting guard reads `greetedArtistIds` via `useStore.getState()` (imperative read) instead of the reactive selector: `markArtistGreeted()` fires inside the run, and if the selector were a reactive dep, the resulting state change would trigger a cleanup/re-run that cancels TTS before audio can play
  - greeting API retry policy:
    - prolonged retries within a bounded global budget (`25s`)
    - when budget is exhausted, fallback greeting text is injected and loading closes deterministically
- Primary-thread cross-device sync (`src/services/primaryThreadSyncService.ts`, `src/hooks/usePrimaryThreadCloudSync.ts`):
  - root layout bootstraps remote primary-thread index and merges artist-level metadata
  - active mode-select/chat artist pulls remote primary-thread messages with cooldown/in-flight guards
  - app foreground/web focus triggers refresh to keep local primary threads aligned across devices
  - post-reply sync in `useChat` uploads latest local primary-thread state to Supabase
- Forced mode nudges removed:
  - no automatic `mode_nudge` injection after N user replies
  - mode-select conversation now keeps natural flow without forced "try modes" interjections
- Meme mode reliability hardening:
  - launch path now inserts only one initial meme intro bubble (no extra `upload_prompt` message)
  - intro wording explicitly points users to the small `+` on the left of the composer for image upload
  - renderer now uses embedded caption font registration and deterministic white-on-black caption drawing
  - bottom caption lane avoids overlap with the Ha-Ha.ai logo, with logo size kept small/stable
  - web share degrades gracefully from native share to browser download/mailto fallback
- Tutorial-mode bound to first completed user turn only:
  - first user turn after tutorial greeting => `tutorialMode=true`
  - all following turns => `tutorialMode=false` (weather/news context allowed again)
- Cathy reaction calibration:
  - prompt now makes `[REACT:emoji]` optional and context-appropriate (not every reply)
  - client guard prevents consecutive reaction badges on neutral turns while allowing affectionate follow-up reactions
- Replay/resume reliability:
  - `useAutoReplayLastArtistMessage` replays latest replayable Cathy message on:
    - first render after hydration
    - app foreground (`AppState=active`)
  - web focus/visibility replay is disabled (`replayOnFocus=false`) in chat and mode-select to avoid surprise replay
  - replay is once-per-message-id and current-conversation scoped
- Multilingual conversation switching:
  - per-turn resolver in chat uses strict priority:
    1. explicit switch command (`parle en ...`, `speak in ...`, ISO/BCP-47 codes) -> immediate persistent switch on active conversation
    2. explicit one-off phrase/translation request -> language override for current turn only (no conversation-language persistence)
    3. auto language detection (script + latin heuristics with ambiguity guard) -> requires injected yes/no confirmation before switch
    4. keep current conversation language
  - auto-switch confirmation behavior:
    - user reply `yes/oui` -> switch + automatic replay of the pending original message
    - user reply `no/non` -> keep current conversation language + automatic replay of the pending original message
    - unclear reply -> short reminder asking for `yes/no`, pending switch request is preserved
  - conversation language persists per conversation and no longer overwrites global app UI language
  - explicit unknown language switch prompts a short clarification request for language code
- Prompt language coherence:
  - server and local fallback prompts now support `fr`, `en`, and `intl` modes
  - French-only Cathy constraints are applied only when active language is French
  - non-French languages keep Cathy personality without forced Quebec-French contractions
- Voice locale alignment:
  - STT starts with conversation locale and retries once using app locale when startup fails due to locale support
  - TTS forwards ISO `language_code` when supported and retries once without locale code on provider locale errors
- TTS reliability hardening:
  - same-origin web candidate priority for `/api/tts` before cross-origin fallbacks
  - per-endpoint timeout with `AbortController` and failover
  - terminal statuses (`401/403/429`) stop endpoint failover and return structured error codes
  - chunk pipeline keeps successful chunks on partial failures
  - final full-text fallback synthesis when no usable chunk set remains
  - stable metadata transitions (`voiceStatus: generating -> ready|unavailable`)
  - per-reply terminal TTS notices are deduplicated and queued after current voice settles (non-intrusive insertion)
  - unavailable voice now remains explicit in message metadata (`voiceStatus='unavailable'` + `voiceErrorCode`) with retry path
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

Full regression validation on **2026-04-13** (auth flow + API error-surface review baseline):

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`111` suites, `621` tests)

Full regression validation on **2026-04-05** (greeting guard imperative read fix + free tier limit increases):

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`99` suites, `550` tests)

Full regression validation on **2026-04-04** (security + performance audit — prompt injection, TTS concurrency, store persistence, FlatList, audio listeners, voice hydration retry):

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`99` suites, `550` tests)

Full regression validation on **2026-04-04** (subscription-cancel resilience + lint baseline restore):

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run verify:profile-prompt` -> PASS
- `npm run test:unit` -> PASS (`99` suites, `550` tests)
- `npm run smoke:auth` -> PASS
- `npm run smoke:voice` -> PASS

Full regression validation on **2026-04-03** (mode-select loading lock fix + cloud sync/image pipeline refresh):

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`97` suites, `534` tests)

Targeted meme reliability validation on **2026-04-02**:

- `npm run test:unit -- api/__tests__/_meme-render.test.js api/__tests__/greeting.test.js src/services/experienceLaunchService.test.ts src/services/modeIntroService.test.ts src/services/memeMediaService.test.ts src/services/memeMediaService.web.test.ts` -> PASS
- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`85` suites, `457` tests)

Full regression validation on **2026-04-01** (full code review + docs alignment):

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`82` suites, `442` tests)
- `npm run verify:profile-prompt` -> PASS
- `npm run smoke:auth` -> PASS
- `npm run smoke:voice` -> PASS

Incremental validation on **2026-03-28** (language confirmation update):

- `npm run test:unit -- src/utils/conversationLanguage.test.ts src/hooks/useChat.sendMessage.integration.test.ts` -> PASS
- `npm run typecheck` -> PASS
- `npx eslint src/utils/conversationLanguage.ts src/utils/conversationLanguage.test.ts src/hooks/useChat.ts src/hooks/useChat.sendMessage.integration.test.ts` -> PASS

Validated on **2026-03-27** (full regression pass + code review refresh):

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`63` suites, `334` tests)
- `npm run verify:profile-prompt` -> PASS
- `npm run smoke:auth` -> PASS
- `npm run smoke:voice` -> PASS

Prior targeted mode-select layout baseline remains available from **2026-03-23**:

- `npm run typecheck` -> PASS
- `npx eslint src/app/mode-select/[artistId]/index.tsx` -> PASS

Detailed run logs:

- [`docs/qa-run-2026-04-13.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-04-13.md)
- [`docs/qa-run-2026-04-05.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-04-05.md)
- [`docs/qa-run-2026-04-04.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-04-04.md)
- [`docs/qa-run-2026-04-03.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-04-03.md)
- [`docs/qa-run-2026-04-02.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-04-02.md)
- [`docs/qa-run-2026-04-01.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-04-01.md)
- [`docs/qa-run-2026-03-27.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-27.md)
- [`docs/qa-run-2026-03-24.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-24.md)
- [`docs/qa-run-2026-03-23.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-23.md)
- [`docs/qa-run-2026-03-20.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-20.md)
- [`docs/qa-run-2026-03-19.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-19.md)
- [`docs/qa-run-2026-03-18.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-18.md)
- [`docs/qa-run-2026-03-17.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-17.md)
- Latest code review snapshot: [`docs/code-review-2026-04-13.md`](/Users/laurentbernier/Documents/HAHA_app/docs/code-review-2026-04-13.md) (full auth + API error-surface review)
- Previous code review: [`docs/code-review-2026-04-04b.md`](/Users/laurentbernier/Documents/HAHA_app/docs/code-review-2026-04-04b.md)

## Games & Prompt Quality (2026-03-25)

### Tirage de Tarot — new game

New game added to the battles section: Cathy Gauthier does a personalized humorous tarot reading.

Game flow:
- Phase 1: theme selection (💕 Mon amour / 💸 Mon argent / ✨ Mon année / 😬 Mon ex)
- Phase 2: pick 3 cards from 5 face-down cards (random pool of 15)
- Phase 3: API generates 3 themed readings + grand finale (single call)
- Phase 4: tap each card to flip (3D animation), then "Voir le verdict" button
- Phase 5: grand finale + replay/exit panel

New files: `src/app/games/[artistId]/tarot-cathy.tsx`, `src/games/hooks/useTarotCathy.ts`, `src/games/services/TarotService.ts`, `src/components/games/TarotCard.tsx`, `src/utils/memoryFacts.ts`, `api/tarot-reading.js`

Fixes applied post-launch:
- Web route restore keeps `/games/` routes eligible (with auth/home filtering and max-age guard)
- Last card no longer auto-completes; added "Voir le verdict de Cathy" button after all 3 cards flipped
- API retry logic (2 attempts on JSON parse failure) + `max_tokens` 800→600 (conciseness)
- CI lint fixes: unused imports in `useChat.ts`, redeclared function in `claude.js`

### Prompt quality improvements

Applied to `api/claude.js`, `api/tarot-reading.js`, `src/services/personalityEngineService.ts`:
- **Quebec anglicisms**: naturalized verb-form anglicisms OK (parké, busté, ghosté), raw English adjectives/nouns replacing French words not OK (big, single, nice)
- **Partner pronoun inference**: deduce partner gender from conversation context; default to neutral when no cues available
- **Tarot variety**: no repeated keyword, place name, or cultural reference across 3 readings + grand finale

### QA Status (2026-03-25)

- `npm run typecheck` → PASS
- `npm run lint` → PASS

## Completion Status

- Phase 4 is functionally delivered for current scope (`web + iOS + API`).
- Remaining work is iterative tuning and browser-specific resilience hardening, not a foundational architecture gap.
