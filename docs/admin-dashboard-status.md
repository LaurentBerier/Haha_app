# Admin Dashboard Status

Last updated: **2026-03-22**

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

- [`docs/qa-run-2026-03-22.md`](/Users/laurentbernier/Documents/HAHA_app/docs/qa-run-2026-03-22.md)

Validated commands:

- `npm run typecheck`
- targeted eslint on admin/auth files

## Known Limitations

- `GET /api/admin-users` search is applied against the current paginated auth page (`auth.admin.listUsers`) rather than full-tenant indexed search.
- If an admin promotion happened recently, user may need sign out/in to refresh JWT claims.
- Dashboard data depends on admin SQL views; if migration is missing, admin APIs will fail.
