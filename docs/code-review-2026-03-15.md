# Code Review Snapshot - 2026-03-15

## Scope

- Repository: `/Users/laurentbernier/Documents/HAHA_app`
- Focus: Phase 2 + Phase 3 production paths (auth, quota, prompt, TTS, score, CI)
- Automated validation run:
  - `npm run qa:phase23` -> PASS
  - Includes `typecheck`, `lint`, `verify:profile-prompt`, `test:unit`, `smoke:auth`, `smoke:voice`

## Findings (ordered by severity)

### 1) Medium - score fallback path is vulnerable to lost updates under concurrency

- File: [`api/score.js`](/Users/laurentbernier/Documents/HAHA_app/api/score.js)
- Lines: fallback read-modify-write flow in `applyScoreActionFallback` (`113-132`)
- Why it matters:
  - When RPC path is unavailable (for example ambiguous SQL function in production), the fallback reads a profile row, computes next counters in JS, then writes the whole patch.
  - Concurrent requests can overwrite each other and drop points/counters.
- Recommendation:
  - Prefer an atomic SQL/RPC fallback (`update ... set score = score + X`, etc.) or transaction-level lock for fallback path.
  - Keep current RPC route as primary once SQL function is fixed, and alert on fallback activation.

### 2) Medium - web TTS blob cache grows without revocation

- File: [`src/services/ttsService.ts`](/Users/laurentbernier/Documents/HAHA_app/src/services/ttsService.ts)
- Lines: cache map + URL creation (`6`, `173-187`)
- Why it matters:
  - `URL.createObjectURL(...)` entries are stored forever in `WEB_TTS_CACHE`.
  - Long sessions can accumulate blob URLs and memory usage.
- Recommendation:
  - Add bounded cache eviction (LRU or max size) and call `URL.revokeObjectURL(...)` on evicted entries.
  - Optionally clear cache on logout/account switch.

## Non-blocking observations

- CI is active and passing on `main` with Node24-compatible action versions.
- Phase 2/3 runtime checks are green in local QA baseline.
- Android validation remains intentionally deferred by product decision.

## Suggested follow-up checklist

1. Implement bounded web TTS cache + object URL revocation.
2. Harden score fallback to an atomic DB update path.
3. Add a concurrency-focused API test for score fallback mode.
