# Troubleshooting

## 1) `supabaseUrl is required`

Symptom:

- App crashes at startup when loading `supabaseClient.ts`.

Cause:

- `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY` is empty.

Fix:

1. Set values in [`.env`](/Users/laurentbernier/Documents/HAHA_app/.env):

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<sb_publishable_or_anon_key>
```

2. Rebuild app:

```bash
npm run ios
```

## 2) Signup email link opens but does not complete in app

Symptom:

- Browser opens Supabase verify URL and nothing happens in app.

Checks:

1. Supabase `Authentication -> URL Configuration` must include redirect URLs:

- `hahaha://auth/callback`
- `hahaha://`
- your web callback (if used)

2. App uses `emailRedirectTo: hahaha://auth/callback` in `authService.ts`.

3. Use the latest email link only. Older links can show `otp_expired`.

## 3) `Network request failed` on login screen

Symptom:

- Login action fails with generic network error.

Likely causes:

- wrong Supabase key type
- invalid base URL
- transient device network path issue

Fix:

- Ensure key from Supabase `API Keys` is publishable/anon public key (not secret/service role).
- Verify URL format: `https://<project-ref>.supabase.co`
- Rebuild app after env changes.

## 4) Vercel function returns `FUNCTION_INVOCATION_FAILED`

Symptom:

- `POST /api/claude` returns 500 with invocation failure.

Common cause:

- Function cannot resolve dependencies (`@supabase/supabase-js`).

Fix:

Ensure `.vercelignore` includes:

```text
!api
!api/**
!vercel.json
!package.json
!package-lock.json
```

Then redeploy:

```bash
npx vercel --prod --yes
```

## 5) `/api/claude` should return 401 but returns 500

Symptom:

- Unauthorized requests crash instead of returning auth error.

Checklist:

- Vercel envs set for project:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ANTHROPIC_API_KEY`
- Confirm deployment includes latest `api/claude.js`.

Quick test:

```bash
curl -i -X POST "https://<alias>.vercel.app/api/claude" \
  -H "content-type: application/json" \
  -d '{"systemPrompt":"test","messages":[{"role":"user","content":"hi"}]}'
```

Expected:

- `401 Unauthorized` when no bearer token.

## 6) `relation "profiles" does not exist` in Supabase SQL

Symptom:

- Running account type SQL fails on `profiles` table missing.

Cause:

- Base profile schema not created yet.

Fix order:

1. Create `public.profiles` + auth trigger.
2. Backfill existing users into profiles.
3. Run `docs/supabase-account-types.sql`.

## 7) `relation "account_types" does not exist`

Symptom:

- Account type verification query fails.

Fix:

- Run `docs/supabase-account-types.sql` in Supabase SQL editor.
- Verify:

```sql
select id, label, rank from public.account_types order by rank;
```

## 8) Cannot launch debug build on physical iPhone (red screen)

Symptom:

- `Could not connect to development server`
- URL points to `http://192.168.x.x:8081/...`

Cause:

- Device cannot reach Metro bundle endpoint.

Pragmatic fix:

- Install a Release build (bundled JS, no Metro dependency):

```bash
npx expo run:ios --device --configuration Release
```

Debug-mode checklist:

- iPhone + Mac same Wi-Fi
- trust developer cert on iPhone
- Developer Mode enabled
- Local Network permission granted
- Metro URL advertised with LAN host

## 9) Tunnel mode prompts repeatedly for `@expo/ngrok`

Symptom:

- `expo start --tunnel` keeps requesting ngrok install.

Workaround:

- Prefer LAN mode or Release build for device testing:

```bash
npx expo start --dev-client --host lan --port 8081
```

or

```bash
npx expo run:ios --device --configuration Release
```

## 10) Admin account type endpoint returns 401/403

Endpoint:

- `POST /api/admin-account-type`

Requirements:

- Bearer token for user with either:
  - `app_metadata.role = 'admin'`
  - `app_metadata.account_type = 'admin'`

If user was just promoted, sign out/in to refresh token claims.

## 11) Promote first admin user

Get user UUID by email:

```sql
select id, email from auth.users where email = 'you@example.com';
```

Promote:

```sql
update public.profiles set account_type_id = 'admin' where id = '<uuid>';

select auth.admin_update_user_by_id(
  '<uuid>',
  '{"app_metadata":{"account_type":"admin","role":"admin"}}'::jsonb
);
```

## 12) `POST /api/delete-account` returns 401

Checklist:

- Ensure app sends `Authorization: Bearer <session.accessToken>`.
- Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel.
- If token is stale, sign out and sign back in.

## 13) `POST /api/payment-webhook` returns 401

Checklist:

- Set `REVENUECAT_WEBHOOK_SECRET` in Vercel.
- Send webhook header `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`.
- In local/dev, endpoint allows unsigned requests unless `NODE_ENV=production`.

## 14) `payment_events` insert fails

Symptom:

- Webhook fails with table/constraint errors.

Fix:

- Re-run `/Users/laurentbernier/Documents/HAHA_app/docs/supabase-account-types.sql`.
- Verify table exists:

```sql
select id, provider, event_type, product_id, created_at
from public.payment_events
order by created_at desc
limit 20;
```
