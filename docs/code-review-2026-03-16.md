# Code Review Snapshot - 2026-03-16

## Scope

- Repository: `/Users/laurentbernier/Documents/HAHA_app`
- Focus:
  - `mode-select` conversation integration
  - greeting generation/fallback flow
  - shared conversation-mode voice loop
  - related global UI/store wiring
- Files reviewed:
  - `src/app/mode-select/[artistId]/index.tsx`
  - `src/hooks/useVoiceConversation.ts`
  - `src/app/_layout.tsx`
  - `src/store/slices/uiSlice.ts`
  - `api/greeting.js`

## Findings (ordered by severity)

### 1) Medium - possible old-conversation flash before first greeting in session (fixed)

- File: [`src/app/mode-select/[artistId]/index.tsx`](/Users/laurentbernier/Documents/HAHA_app/src/app/mode-select/[artistId]/index.tsx)
- Risk:
  - Before the first session greeting completed, selector logic could pick an older `on-jase` conversation briefly.
  - This could violate expected flow where intro starts a fresh session thread.
- Resolution:
  - Conversation selection now gates on `greetedArtistIds` (except E2E bypass), returning empty conversation id until greeting flow creates the session conversation.

### 2) Low - greeting API backoff could be applied even when a later candidate endpoint succeeded (fixed)

- File: [`src/app/mode-select/[artistId]/index.tsx`](/Users/laurentbernier/Documents/HAHA_app/src/app/mode-select/[artistId]/index.tsx)
- Risk:
  - Early endpoint failure could set global backoff, degrading subsequent greeting personalization despite a successful fallback endpoint.
- Resolution:
  - Backoff now applies only after all candidates fail with server/network errors.
  - Backoff is cleared when any endpoint returns a valid greeting payload.

## Open Findings

- No remaining blocking findings in reviewed scope.

## Validation

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (20 suites, 115 tests)

## Residual Risk / Follow-up

- Voice UX in web browsers is permission/device dependent; keep manual QA on:
  - first-entry mode-select greeting playback
  - STT resume after greeting playback
  - barge/interrupt behavior during longer responses
