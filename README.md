# Ha-Ha.ai (Phase 1 Closed)

Ha-Ha.ai is a React Native Expo app for chatting with AI comedian personas.
Phase 1 is closed (as of 2026-02-27) and ships one artist (`Cathy Gauthier`) with dual chat backends:

- live Anthropic Claude integration
- local mock generator fallback

## Current Status

- Phase status: closed; remaining non-MVP items are deferred to Phase 2+.

- Platform: Expo SDK 53, React Native 0.79.6, TypeScript strict.
- Routing: Expo Router with app root at `src/app`.
- State: Zustand slices with persisted domain state.
- Personality: dynamic prompt assembly (`personalityEngineService.ts`).
- Backend:
  - live Claude proxy client (`claudeApiService.ts` -> `EXPO_PUBLIC_CLAUDE_PROXY_URL`)
  - serverless proxy endpoint (`api/claude.js`) for Anthropic API calls
  - mock reply generator (`mockLlmService.ts`)
- Modes: 8 Cathy modes (including `radar-attitude`).
- Mode behavior: selecting a creative mode always creates a new conversation; selecting `Historique/Chat History` opens the latest 20 conversations for that artist.
- Mode selection: scrollable list and resilient icon fallback for newly added modes.
- Chat UX: auto-scroll to latest messages while preserving manual scroll when user reads older content.
- Chat composer: dark bottom bar with `+` image attach, voice mic toggle, and right-side discussion/send action button.
- Language behavior: app default is `fr-CA`; if user input is detected as mostly English, active chat language auto-switches to `en-CA`.
- Home UX: Cathy visual selector with circular photo avatar and tap-to-enter interaction (no separate start button).
- Home selector is intentionally minimal: no helper hint text, no language metadata row, and one concise artist-genre line under the name.
- Menus include continuous one-direction ambient orbital glow with layered parallax depth.
- Glow layer now uses a stronger blurred-light look and animated pulsing luminosity for a dynamic premium effect.
- Persistence: hybrid storage (`AsyncStorage` + `expo-secure-store`).
- Voice input: on-device speech-to-text via `expo-speech-recognition` integrated in chat input.
- Image input: users can attach one image from gallery (`+`) and send text + image to Claude via the proxy.
- Import pipeline: XLSX -> generated TypeScript mode config + few-shots.
- Testing: Detox iOS E2E tests (Release simulator build).
- iOS: native project generated (`ios/`) and runnable.

## Prerequisites

- Node.js 20+
- npm 10+
- Xcode (latest available for SDK 53 workflow)
- CocoaPods (`pod` on PATH)
- iOS Simulator runtime matching your Xcode destination (for this workspace, iOS 26.2 was required)
- `applesimutils` (`brew install applesimutils`) for Detox E2E

## Setup

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm install
```

## LLM Configuration

```bash
cp .env.example .env
```

Environment variables:

- `EXPO_PUBLIC_USE_MOCK_LLM=true|false`
- `EXPO_PUBLIC_CLAUDE_PROXY_URL=https://<your-backend>/api/claude`
- `EXPO_PUBLIC_ANTHROPIC_MODEL=claude-sonnet-4-5-20250929`

Important:

- In Expo apps, `EXPO_PUBLIC_*` values must be read via direct `process.env.EXPO_PUBLIC_*` access.
- This project implements that in `src/config/env.ts`.
- If this is refactored to dynamic env lookups, production builds can silently fall back to mock mode.

Backend secret (server-side only, never in Expo public env):

- `ANTHROPIC_API_KEY=sk-ant-...`

Defaults:

- Mock mode is enabled when `EXPO_PUBLIC_USE_MOCK_LLM` is missing.
- Live Claude mode requires `EXPO_PUBLIC_USE_MOCK_LLM=false` and a configured proxy URL.

Runtime behavior:

- In React Native runtime (Expo Go/dev-client), Claude calls are executed in non-stream mode for compatibility.
- In non-React Native runtime, SSE streaming is used.
- UI still renders token/appended content through the same message pipeline.
- User turns support optional multimodal payloads (text and one image block).
- Proxy validates image formats (`image/jpeg`, `image/png`, `image/webp`, `image/gif`) and enforces a ~3MB max image size.
- If Claude request fails at runtime, chat automatically falls back to mock generation for resilience.
- Conversation history is captured before appending the current user turn to avoid duplicate-turn payloads.

Quick live Claude check:

```bash
curl -sS -X POST "https://<your-vercel-project>.vercel.app/api/claude" \
  -H "Content-Type: application/json" \
  --data '{"model":"claude-sonnet-4-5-20250929","maxTokens":64,"temperature":0.2,"stream":false,"systemPrompt":"Reply in one short sentence.","messages":[{"role":"user","content":"Say hello in French."}]}'
```

## Deploy Claude Proxy (Vercel)

This repo includes a serverless endpoint at `/api/claude` in [api/claude.js](/Users/laurentbernier/Documents/HAHA_app/api/claude.js).

1. Create/link a Vercel project:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx vercel
```

2. Set backend env vars in Vercel Project Settings:

- `ANTHROPIC_API_KEY` = your rotated key
- Optional hardening: `ALLOWED_ORIGINS` = comma-separated list (e.g. `https://your-web-app.example`)

3. Deploy:

```bash
npx vercel --prod --yes --archive=tgz
```

4. Copy production URL and set app env:

```bash
EXPO_PUBLIC_CLAUDE_PROXY_URL=https://<your-vercel-project>.vercel.app/api/claude
```

5. Keep deployment upload small by scoping `.vercelignore`:

```bash
*
!api
!api/**
!vercel.json
```

6. Restart Expo:

```bash
npm run start -- --clear
```

7. Redeploy the proxy after any `api/claude.js` multimodal/security change:

```bash
npx vercel --prod --yes --archive=tgz
```

## Run

```bash
# Start dev server
npm run start

# Launch iOS build + simulator app
npm run ios

# Launch on connected iPhone/iPad
npx expo run:ios --device

# Build/install Release on device (embedded JS bundle, no Metro dependency)
npx expo run:ios --device --configuration Release
```

Physical device notes:

- Keep the phone unlocked during install/launch.
- If iOS asks to trust developer profile: `Settings -> General -> VPN & Device Management`.

## Validation

```bash
npm run typecheck
npm run lint
npx expo install --check
npm run e2e:ios
```


## Mode Data Import

Mode data is sourced from `HiHa_Cathy_Liste_Complete_Par_Mode.xlsx` and converted to TypeScript via:

```bash
npm run import:modes
```

Generated files:

- `src/config/modes.ts`
- `src/data/cathy-gauthier/modeFewShots.ts`

## E2E (iOS Simulator)

```bash
# build app binary for Detox
npm run e2e:build:ios

# run E2E tests
npm run e2e:ios
```

## Scripts

- `npm run start`: start Expo dev server
- `npm run ios`: prebuild/run iOS app in Simulator
- `npm run android`: Android native run (not validated in this phase)
- `npm run web`: Expo web
- `npm run typecheck`: strict TypeScript check
- `npm run lint`: ESLint flat-config check
- `npm run e2e:build:ios`: build Detox iOS simulator binary
- `npm run e2e:ios`: run Detox iOS E2E tests

## Navigation Flow

- Home -> mode-select -> chat
- Home -> mode-select -> history -> existing chat
- Home screen entry is triggered by tapping the artist photo or name area (`artist-start-<id>`).
- Mode is persisted per conversation (`conversation.modeId`).
- Non-history mode selection always creates a fresh conversation.

## Architecture Summary

- UI screens: `src/app`
- Components: `src/components`
- State slices: `src/store/slices`
- Hooks and orchestration: `src/hooks`
- Services: `src/services`
- Domain models: `src/models`
- Config/i18n/theme: `src/config`, `src/i18n`, `src/theme`
- Artist avatar assets: `CathyGauthier.jpg` + `src/config/artistAssets.ts`

Detailed architecture docs: `docs/architecture.md`

## Persistence

Persisted via hybrid storage:

- `AsyncStorage`: conversations, messages, active IDs, UI/domain non-sensitive data
- `expo-secure-store`: `subscription`, `unlockedArtistIds`
- Message storage shape is pagination-ready: `messagesByConversation: Record<string, MessagePage>`

Hydration occurs at app startup in `src/app/_layout.tsx` via `useStorePersistence()`.

## Known Gaps (Phase 1)

- No auth/rate-limit layer yet in front of the proxy endpoint.
- Voice text transcription is implemented; voice synthesis/playback remains stubbed.
- Discussion feature button is present in chat composer, but full discussion mode is not implemented yet (shows coming-soon message).
- Language auto-switch currently targets FR -> EN detection only (no automatic EN -> FR switch-back yet).
- No subscription/analytics features yet.
- No backend/integration tests yet (only iOS E2E currently).

## Troubleshooting

See: `docs/troubleshooting.md`
