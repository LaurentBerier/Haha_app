# Ha-Ha.ai (Phase 1)

Ha-Ha.ai is a React Native Expo app for chatting with AI comedian personas.
Phase 1 currently ships one artist (`Cathy Gauthier`) with dual chat backends:

- live Anthropic Claude integration
- local mock generator fallback

## Current Status

- Platform: Expo SDK 53, React Native 0.79.6, TypeScript strict.
- Routing: Expo Router with app root at `src/app`.
- State: Zustand slices with persisted domain state.
- Personality: dynamic prompt assembly (`personalityEngineService.ts`).
- Backend:
  - live Claude API client (`claudeApiService.ts`)
  - mock reply generator (`mockLlmService.ts`)
- Modes: 8 Cathy modes (including `radar-attitude`).
- Persistence: hybrid storage (`AsyncStorage` + `expo-secure-store`).
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
- `EXPO_PUBLIC_ANTHROPIC_API_KEY=<your_key>`
- `EXPO_PUBLIC_ANTHROPIC_MODEL=claude-sonnet-4-5-20250929`

Defaults:

- Mock mode is enabled when `EXPO_PUBLIC_USE_MOCK_LLM` is missing.
- Live Claude mode requires `EXPO_PUBLIC_USE_MOCK_LLM=false` and a valid API key.

Runtime behavior:

- In React Native runtime (Expo Go/dev-client), Claude calls are executed in non-stream mode for compatibility.
- In non-React Native runtime, SSE streaming is used.
- UI still renders token/appended content through the same message pipeline.

## Run

```bash
# Start dev server
npm run start

# Launch iOS build + simulator app
npm run ios
```

## Validation

```bash
npm run typecheck
npm run lint
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
- Mode is persisted per conversation (`conversation.modeId`)

## Architecture Summary

- UI screens: `src/app`
- Components: `src/components`
- State slices: `src/store/slices`
- Hooks and orchestration: `src/hooks`
- Services: `src/services`
- Domain models: `src/models`
- Config/i18n/theme: `src/config`, `src/i18n`, `src/theme`

Detailed architecture docs: `docs/architecture.md`

## Persistence

Persisted via hybrid storage:

- `AsyncStorage`: conversations, messages, active IDs, UI/domain non-sensitive data
- `expo-secure-store`: `subscription`, `unlockedArtistIds`
- Message storage shape is pagination-ready: `messagesByConversation: Record<string, MessagePage>`

Hydration occurs at app startup in `src/app/_layout.tsx` via `useStorePersistence()`.

## Known Gaps (Phase 1)

- No secure backend proxy yet for Anthropic key management (client-side key in dev/staging only).
- No voice/subscription/analytics features (service stubs only).
- No backend/integration tests yet (only iOS E2E currently).

## Troubleshooting

See: `docs/troubleshooting.md`
