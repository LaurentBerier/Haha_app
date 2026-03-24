# Admin Dashboard Status

Last updated: **2026-03-24**

## Scope

This document tracks the current implementation status of the admin dashboard UI/API in `HAHA_app`.

## Current UI State

Admin routes:

- `/admin` (dashboard)
- `/admin/users` (user operations)

Access and visibility:

- Admin menu entry is visible in both:
  - Settings screen (`/settings`)
  - Header hamburger account menu
- Route-level guard in `src/app/admin/_layout.tsx` redirects non-admin users to `/settings`.
- Auth bootstrap is root-owned (`useAuth({ bootstrap: true })` in `src/app/_layout.tsx`) to prevent nested-route loading loops.
- Root stack registers only `admin` as nested entry; child screens (`index`, `users`) are declared in `src/app/admin/_layout.tsx` to avoid Expo Router nested route warnings.

Dashboard screen (`src/app/admin/index.tsx`):

- Period selector: `7d`, `30d`, `mtd`
- KPI cards:
  - peak DAU
  - message volume
  - TTS characters
  - estimated cost
- Cost/revenue summary with net margin
- Messages-by-tier bar rows
- Revenue events list
- Defensive response-shape guards to avoid runtime crashes on malformed payloads

Users screen (`src/app/admin/users.tsx`):

- Search input (email/id)
- Tier filters (`all`, `free`, `regular`, `premium`, `admin`)
- Pagination (`25` rows/page)
- Per-user expandable actions:
  - change account tier
  - set/clear monthly quota override
- Defensive list/total guards for malformed payloads

## Current API State

Admin endpoints in active use:

- `GET /api/admin-stats`
- `GET /api/admin-users`
- `POST /api/admin-quota-override`
- `POST /api/admin-account-type`

Auth requirements:

- Bearer JWT with:
  - `app_metadata.role='admin'`, or
  - `app_metadata.account_type='admin'`

Database dependencies:

- migration file: `supabase/migrations/20260321_admin_dashboard.sql`
- required views:
  - `admin_daily_usage`
  - `admin_revenue_summary`
  - `admin_user_list`
- required profile column:
  - `profiles.monthly_cap_override`
- `admin_user_list` view replacement must preserve the expected column mapping used by `api/admin-users.js`:
  - `id,id_text,email,auth_created_at,tier,messages_this_month,monthly_cap_override,monthly_reset_at,last_active_at,total_events`

## Client Configuration State

Recommended env configuration:

- `EXPO_PUBLIC_API_BASE_URL=https://app.ha-ha.ai/api`
- `EXPO_PUBLIC_CLAUDE_PROXY_URL=https://app.ha-ha.ai/api/claude`

Current admin client behavior (`src/services/adminService.ts`):

- resolves backend base URL from `EXPO_PUBLIC_API_BASE_URL` (fallback from `EXPO_PUBLIC_CLAUDE_PROXY_URL`)
- calls normalized endpoint paths (`/admin-stats`, `/admin-users`, `/admin-quota-override`, `/admin-account-type`)
- rejects invalid/non-JSON responses with explicit error

## Validation Snapshot

Latest targeted QA run:

- [`docs/qa-run-2026-03-24.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-24.md)

Validated commands:

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` (includes `api/__tests__/admin-users.test.js`)

## Known Limitations

- `GET /api/admin-users` search depends on data freshness/shape in `admin_user_list`; if the view is altered, keep expected columns and aliases stable.
- If an admin promotion happened recently, user may need sign out/in to refresh JWT claims.
- Dashboard data depends on admin SQL views; if migration is missing, admin APIs will fail.
