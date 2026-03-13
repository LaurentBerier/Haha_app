# Project Status

## Baseline

- Phase 1 closed on **2026-02-27**
- Original MVP scope (single-artist chat) delivered
- Current execution tracking moved to `docs/phase2-status.md`

## Current State (2026-03-13)

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
- Native auth redirects now force `hahaha://auth/callback` on iOS/Android; web callback supports mobile handoff to app deep link
- Onboarding persisted to `public.profiles`
- Settings flows:
  - edit profile
  - preferred display-name editing
  - language and motion preferences (dark mode is fixed)
  - subscription plan screen with Stripe plan CTAs (regular/premium), current cycle, and cancel action
  - sign out
  - account deletion
- Global app top bar/hamburger UI is unified across authenticated web/mobile app routes
- Universal back button is now available across secondary pages (mode select, chat, history, settings subpages)
- Chat header now displays the active mode name (emoji + label) instead of a generic title
- On Jase? category simplified to 2 core modes (`On jase!`, `Mets-moi sur le grill`) with legacy mode-id compatibility server-side
- Artist selection now uses clear availability states:
  - available artist with explicit CTA (`Parler avec Cathy`)
  - upcoming artists with silhouette placeholder + "Disponible bientôt"
- Claude proxy bearer-token enforcement with Supabase validation
- Account type infrastructure:
  - extensible tier model (`free`, `regular`, `premium`, `admin`, custom)
  - admin endpoint to assign account type
- Payment webhook + Stripe billing endpoints now wired for tier updates and subscription state reads
- Account-scoped persistence hardening now clears local conversations/messages automatically when switching users on the same device/browser

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run test:unit
```

## Cross-Repo Context

Production now uses two distinct repos/projects with clear ownership:

- Landing repo -> Vercel project `ha-ha-ai` -> `https://ha-ha.ai`
- App repo (`HAHA_app`, this repo) -> Vercel project `haha-app` -> `https://app.ha-ha.ai`

Deployment for this repo:

- `npx vercel --prod --yes` (project `haha-app`)
- Vercel build uses `npm run export:web` via `vercel.json`

## Next Priorities

- Expand automated integration/e2e coverage for:
  - signup/confirm/login
  - forgot-password/recovery
  - onboarding completion and skip
  - claude proxy 401/200 auth behavior
- Harden production observability for serverless endpoints
