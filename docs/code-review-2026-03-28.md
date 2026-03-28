# Code Review Snapshot - 2026-03-28

## Scope

- Repository: `/Users/laurentbernier/Documents/HAHA_app`
- Focus:
  - full regression baseline refresh (app + API)
  - rate-limit correctness under non-default windows
  - web TTS memory safety and auth/session cache reset behavior
  - core docs currency (`README`, `architecture`, `.env.example`, QA/review snapshots)
- Files reviewed/updated (high-risk subset):
  - `api/_utils.js`
  - `api/claude.js`
  - `api/__tests__/_utils.rate-limit.test.js`
  - `api/__tests__/claude.test.js`
  - `src/services/ttsService.ts`
  - `src/services/ttsService.test.ts`
  - `src/hooks/useAuth.ts`

## Findings (ordered by severity)

### 1) Resolved - IP rate-limit window now honors configured window size in KV math

- Files:
  - [`api/_utils.js`](/Users/laurentbernier/Documents/HAHA_app/api/_utils.js)
  - [`api/claude.js`](/Users/laurentbernier/Documents/HAHA_app/api/claude.js)
- Outcome:
  - bucket index/progress now derive from the effective `windowMs` instead of a hard-coded 60-second bucket
  - KV keys are window-qualified to avoid cross-window key collisions
  - explicit regression tests added for non-default windows

### 2) Resolved - web TTS cache is now bounded and object URLs are revoked on eviction/reset

- Files:
  - [`src/services/ttsService.ts`](/Users/laurentbernier/Documents/HAHA_app/src/services/ttsService.ts)
  - [`src/services/ttsService.test.ts`](/Users/laurentbernier/Documents/HAHA_app/src/services/ttsService.test.ts)
  - [`src/hooks/useAuth.ts`](/Users/laurentbernier/Documents/HAHA_app/src/hooks/useAuth.ts)
- Outcome:
  - cache now uses bounded LRU behavior
  - evicted entries call `URL.revokeObjectURL(...)`
  - new `clearVoiceCacheOnSessionReset()` is invoked during auth/session reset paths

## Deferred/Out Of Scope

- Score fallback concurrency hardening is intentionally deferred because the score system will be redesigned alongside upcoming game changes.

## Validation

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit -- api/__tests__/_utils.rate-limit.test.js api/__tests__/claude.test.js src/services/ttsService.test.ts` -> PASS
- `npm run test:unit` -> PASS (`64` suites, `346` tests)
- `npm run verify:profile-prompt` -> PASS
- `npm run smoke:auth` -> PASS
- `npm run smoke:voice` -> PASS
