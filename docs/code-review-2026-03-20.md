# Code Review Snapshot - 2026-03-20

## Scope

- Repository: `/Users/laurentbernier/Documents/HAHA_app`
- Focus:
  - conversation-mode reliability (`typed-first reply`, mic resume lifecycle)
  - tutorial/reaction behavior changes
  - TTS terminal-error handling and quota notices
  - tier caps/rate-limits consistency
- Files reviewed:
  - `src/hooks/useVoiceConversation.ts`
  - `src/hooks/useChat.ts`
  - `src/hooks/chatBehavior.ts`
  - `src/services/ttsService.ts`
  - `src/server/ttsHandler.js`
  - `src/app/mode-select/[artistId]/index.tsx`
  - `api/claude.js`
  - `api/usage-summary.js`
  - `api/subscription-summary.js`

## Findings (ordered by severity)

### 1) Low - terminal voice notices can still trigger one extra failing TTS request

- File: [`src/hooks/useChat.ts`](/Users/laurentbernier/Documents/HAHA_app/src/hooks/useChat.ts)
- Lines: around `1177-1180` + `786-788`
- Risk:
  - when a reply ends with terminal TTS status (`403/429`), the post-reply notice is queued with `spoken: true`
  - the follow-up synthesis attempt is expected to fail in the same terminal state, adding one avoidable noisy request
- Impact:
  - no functional break (text notice is preserved), but extra console/network noise and quota pressure in high-error sessions

### 2) Low - deferred post-reply notice can arrive after a newer turn has already started

- File: [`src/hooks/useChat.ts`](/Users/laurentbernier/Documents/HAHA_app/src/hooks/useChat.ts)
- Lines: around `762-789`
- Risk:
  - notice insertion waits for prior audio settle asynchronously
  - if user sends another turn quickly, notice from previous turn can appear later than expected
- Impact:
  - conversational ordering can feel slightly off in fast back-to-back exchanges

## Open Findings

- No blocking (high/medium) findings in reviewed scope.
- Two low-severity ordering/noise risks remain as noted above.

## Validation

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (29 suites, 183 tests)
- `npm run verify:profile-prompt` -> PASS
- `npm run smoke:auth` -> PASS
- `npm run smoke:voice` -> PASS (`tts with auth -> 200`)
