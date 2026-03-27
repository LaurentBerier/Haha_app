# Code Review Snapshot - 2026-03-27

## Scope

- Repository: `/Users/laurentbernier/Documents/HAHA_app`
- Focus:
  - full regression baseline refresh (app + API)
  - auth, admin, billing/webhook, quota, and voice runtime safety
  - documentation currency and operational runbook alignment
- Files reviewed (high-risk subset):
  - `api/admin-account-type.js`
  - `api/payment-webhook.js`
  - `api/stripe-webhook.js`
  - `api/subscription-summary.js`
  - `api/subscription-cancel.js`
  - `api/usage-summary.js`
  - `api/_utils.js`
  - `src/hooks/useVoiceConversation.ts`
  - `src/app/mode-select/[artistId]/index.tsx`

## Findings (ordered by severity)

### 1) Medium - account tier sync is non-atomic across profile and auth metadata writes

- Files:
  - [`api/admin-account-type.js`](/Users/laurentbernier/Documents/HAHA_app/api/admin-account-type.js) (around `170-184`)
  - [`api/payment-webhook.js`](/Users/laurentbernier/Documents/HAHA_app/api/payment-webhook.js) (around `305-319`)
  - [`api/stripe-webhook.js`](/Users/laurentbernier/Documents/HAHA_app/api/stripe-webhook.js) (around `562-575`)
- Risk:
  - account-type changes are written to `profiles.account_type_id` first, then to Supabase auth `app_metadata.account_type`
  - if metadata update fails after the profile update succeeds, handlers return `500` with a partial write already committed
- Impact:
  - temporary tier drift between profile data and JWT-backed metadata can occur
  - admin access and tier-dependent behavior may appear inconsistent until metadata is repaired and clients refresh claims
- Recommendation:
  - use a compensating rollback (or coordinated transaction pattern with retry queue) so a metadata failure does not leave a committed partial tier change

## Open Findings

- No additional high/medium findings were discovered in the reviewed scope.
- Residual risk remains in areas not fully covered by unit tests (cross-service failure paths in webhook flows and external provider outages).

## Validation

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm run test:unit` -> PASS (`63` suites, `334` tests)
- `npm run verify:profile-prompt` -> PASS
- `npm run smoke:auth` -> PASS
- `npm run smoke:voice` -> PASS
