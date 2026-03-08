# Project Status

## Baseline

- Phase 1 closed on **2026-02-27**
- Original MVP scope (single-artist chat) delivered
- Current execution tracking moved to `docs/phase2-status.md`

## Current State (2026-03-08)

Implemented in this repository:

- Supabase auth in mobile app:
  - email/password
  - Apple Sign-In
  - session restore
  - auth state sync with store
- Complete auth route set:
  - login, signup, forgot-password, reset-password, onboarding, callback
- Signup confirmation UX now explicitly instructs users to check spam/junk for Ha-Ha.ai confirmation email
- Auth callback now handles expired/invalid links with recovery actions (resume via login or restart signup)
- Onboarding persisted to `public.profiles`
- Settings flows:
  - edit profile
  - language and display preferences
  - subscription plan screen with Stripe plan CTAs (regular/premium), current cycle, and cancel action
  - sign out
  - account deletion
- Global app top bar/hamburger UI is unified across web and mobile app routes
- Claude proxy bearer-token enforcement with Supabase validation
- Account type infrastructure:
  - extensible tier model (`free`, `regular`, `premium`, `admin`, custom)
  - admin endpoint to assign account type
- Payment webhook + Stripe billing endpoints now wired for tier updates and subscription state reads

## Validation Commands

```bash
npm run typecheck
npm run lint
```

## Cross-Repo Context

The website repo (`ha-ha.ai`) now has Supabase auth + onboarding + reset password flows and bridges `/app*` routes to the real Expo web build from this mobile repo (`HAHA_app`). Both repos should be validated/deployed in lockstep.

Web deployment for this repo is now documented and automated via:

- `npm run export:web`
- `npm run deploy:web`

## Next Priorities

- Expand automated integration/e2e coverage for:
  - signup/confirm/login
  - forgot-password/recovery
  - onboarding completion and skip
  - claude proxy 401/200 auth behavior
- Harden production observability for serverless endpoints
