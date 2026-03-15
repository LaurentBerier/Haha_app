# Phase 3 Status (Voice + Prompt Intelligence)

Last updated: **2026-03-15**

## Scope

Phase 3 focuses on two tracks:

- high-quality Cathy voice output (ElevenLabs TTS, tier-aware)
- stronger Cathy prompt quality (style fidelity, structure, vulnerability handling, user profile memory)

## Delivered

- ElevenLabs TTS pipeline is live end-to-end in app code:
  - `/api/tts` requests are routed by Vercel to `api/claude.js?__proxy=tts`
  - proxy dispatches to server handler: `src/server/ttsHandler.js`
  - paid tier gate (`regular`, `premium`, `admin`) + usage/rate checks on `usage_events`
  - provider output served as `audio/mpeg` with normalized error codes
- Voice selection is env-driven and swappable without code changes:
  - `EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC`
  - `EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY`
- Client voice service implemented:
  - `src/services/ttsService.ts`
  - web: `Blob` + `URL.createObjectURL(...)` cache
  - native: `expo-file-system` cache (`tts_<hash>.mp3`)
- Audio player hook implemented with queue support:
  - `src/hooks/useAudioPlayer.ts`
  - single active sound, pause/stop, queue playback, web/native fallback
- Chat flow integration completed:
  - sentence chunking during streaming + background TTS pre-generation in `src/hooks/useChat.ts`
  - metadata updates (`voiceStatus`, `voiceUrl`, `voiceQueue`)
  - auto-play toggle support via store setting
- Chat bubble voice controls implemented:
  - spinner while generating
  - play/pause button when audio is ready
- Voice engine stub removed:
  - `src/services/voiceEngine.ts` now delegates to `fetchAndCacheVoice(...)`
- Phase 4 scaffold is present:
  - `src/hooks/useVoiceConversation.ts` exported and intentionally not implemented
- Prompt upgrade for Cathy is integrated in `api/claude.js`:
  - global knowledge section
  - response structure contract
  - vulnerability/mental-health fallback behavior
  - style constraints (accenting/format guardrails)
  - stronger user-profile usage (including playful astro assumptions)

## QA Progress

- Unit tests extended for TTS backend contract in `api/__tests__/tts.test.js`:
  - unsupported artist (`400`)
  - missing ElevenLabs key (`500 SERVER_MISCONFIGURED`)
  - ElevenLabs quota mapping (`402/429 -> TTS_QUOTA_EXCEEDED`)
- Claude proxy coverage extended in `api/__tests__/claude.test.js`:
  - verifies `__proxy=tts` dispatch path
- Voice smoke script added:
  - `scripts/smoke-voice.sh`
  - checks preflight CORS + unauth auth behavior + optional authenticated voice probe
- consolidated Phase 2/3 QA runner added:
  - `scripts/qa-phase23.sh`
  - npm alias: `npm run qa:phase23`
- iOS Detox E2E validated:
  - `npm run e2e:build:ios` PASS
  - `npm run e2e:ios` PASS (`3/3`)
- QA execution report published:
  - `docs/qa-run-2026-03-14.md`
- Phase 2/3 CI workflow added:
  - `.github/workflows/phase23-ci.yml`
  - automates `typecheck`, `lint`, `verify:profile-prompt`, `test:unit`
- mobile preflight check script added:
  - `scripts/check-mobile-env.sh`
  - npm alias: `npm run check:mobile-env`

## Completion Status

- Phase 3 is complete for the current execution scope (`web + API + iOS`).
- Voice production path is validated in production with authenticated paid-tier smoke (`/api/tts -> 200`).
- Android manual voice QA is intentionally deferred for now.

## Explicitly Out of Scope (Current Execution)

- PayPal/Apple checkout end-to-end activation

## Verification Baseline

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run smoke:auth
npm run smoke:voice
npm run qa:phase23
```

Optional authenticated voice smoke:

```bash
SMOKE_AUTH_TOKEN=<supabase_access_token> npm run smoke:voice
```

## Deployment Guardrail

For this repository, the only valid Vercel target is:

- scope/team: `snadeau-breakingwalls-projects`
- project: `haha-app`

Never deploy this repo from `lbernier-2067s-projects`.
