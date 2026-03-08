# Troubleshooting

## 1) `supabaseUrl is required`

Cause:

- `EXPO_PUBLIC_SUPABASE_URL` and/or `EXPO_PUBLIC_SUPABASE_ANON_KEY` is missing.

Fix:

1. Set values in [`.env`](/Users/laurentbernier/Documents/HAHA_app/.env):

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<sb_publishable_key_or_anon_key>
```

2. Restart Expo/Metro and rebuild if needed:

```bash
npm run start
npm run ios
```

## 2) Signup confirmation link opens but app does not complete auth

Checklist in Supabase `Authentication -> URL Configuration`:

- Site URL set to your canonical web domain (for web)
- Redirect URLs include:
  - `hahaha://auth/callback`
  - `https://www.ha-ha.ai/auth/callback`
  - `https://ha-ha.ai/auth/callback`

Also ensure the email template uses `{{ .ConfirmationURL }}`.

User guidance:

- After signup, users should be told to check spam/junk for the Ha-Ha.ai confirmation email.
- If callback opens with an expired/invalid link, the app now shows recovery actions:
  - `Se connecter pour reprendre`
  - `Recommencer l'inscription`

## 3) Password reset link opens but does not reach reset screen

Expected mobile flow:

- App sends reset with `redirectTo=hahaha://auth/callback?flow=recovery`
- Callback route resolves recovery and redirects to `/(auth)/reset-password`

If it fails:

- Verify reset template uses `{{ .ConfirmationURL }}`
- Verify redirect URL list includes `hahaha://auth/callback`
- Use a fresh recovery email (old links expire)

## 4) `Network request failed` on login/signup

Common causes:

- wrong key type (using secret/service role key in app)
- malformed URL
- stale build after env change

Fix:

- App must use publishable/anon key only
- URL must match `https://<project-ref>.supabase.co`
- rebuild app after env update

## 5) Device build cannot connect to development server

Symptom:

- red screen with `Could not connect to development server`

Fix options:

- run Release build (bundled JS):

```bash
npx expo run:ios --device --configuration Release
```

- or debug build with Metro on same network:
  - same Wi-Fi
  - developer mode on
  - local network permission granted

## 6) Vercel function `FUNCTION_INVOCATION_FAILED`

Common cause:

- runtime dependencies unavailable in deployment bundle

Required `.vercelignore` entries:

```text
!api
!api/**
!package.json
!package-lock.json
!vercel.json
```

Redeploy:

```bash
npx vercel --prod --yes
```

## 7) `/api/claude` returns 500 instead of 401

Verify Vercel env vars:

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- if request comes from a browser origin: `ALLOWED_ORIGINS` must include that origin

No-auth smoke test should return `401`:

```bash
curl -i -X POST "https://<alias>.vercel.app/api/claude" \
  -H "content-type: application/json" \
  -d '{"systemPrompt":"test","messages":[{"role":"user","content":"hi"}]}'
```

## 8) SQL error `relation "profiles" does not exist`

Cause:

- account-type SQL was run before base profile schema.

Fix order:

1. create `public.profiles` + signup trigger
2. backfill existing users if needed
3. run [`docs/supabase-account-types.sql`](/Users/laurentbernier/Documents/HAHA_app/docs/supabase-account-types.sql)

## 9) SQL error `relation "account_types" does not exist`

Fix:

- run [`docs/supabase-account-types.sql`](/Users/laurentbernier/Documents/HAHA_app/docs/supabase-account-types.sql)

Verify:

```sql
select id, label, rank from public.account_types order by rank;
```

## 10) `POST /api/admin-account-type` returns 401/403

Requirements:

- Bearer token from user with:
  - `app_metadata.role = 'admin'`, or
  - `app_metadata.account_type = 'admin'`

If user was just promoted, sign out/in to refresh token claims.

## 11) Promote first admin user

```sql
select id, email from auth.users where email = 'you@example.com';
```

```sql
update public.profiles set account_type_id = 'admin' where id = '<uuid>';

select auth.admin_update_user_by_id(
  '<uuid>',
  '{"app_metadata":{"account_type":"admin","role":"admin"}}'::jsonb
);
```

## 12) `POST /api/delete-account` returns 401

Checklist:

- app sends `Authorization: Bearer <session.accessToken>`
- Vercel has:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- token not expired (re-login if needed)

## 13) `POST /api/payment-webhook` returns 401

Checklist:

- `REVENUECAT_WEBHOOK_SECRET` set in Vercel
- webhook sends `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`

If `REVENUECAT_WEBHOOK_SECRET` is missing, endpoint returns `500` (`SERVER_MISCONFIGURED`) by design.

## 14) `payment_events` insert fails

Fix:

- rerun [`docs/supabase-account-types.sql`](/Users/laurentbernier/Documents/HAHA_app/docs/supabase-account-types.sql)

Verify:

```sql
select id, provider, event_type, product_id, created_at
from public.payment_events
order by created_at desc
limit 20;
```

## 15) `POST /api/stripe-webhook` returns 401

Checklist:

- `STRIPE_WEBHOOK_SECRET` is set in Vercel.
- Stripe endpoint uses this URL:
  - `https://<your-domain>/api/stripe-webhook`
- Stripe sends the `Stripe-Signature` header (default behavior).

Recommended Stripe events:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## 16) Stripe webhook processed but account type did not change

Checklist:

- `STRIPE_PAYMENT_LINK_ID_REGULAR` / `STRIPE_PAYMENT_LINK_ID_PREMIUM` configured.
- `STRIPE_PRICE_ID_REGULAR_MONTHLY` / `STRIPE_PRICE_ID_PREMIUM_MONTHLY` configured.
- app sends `client_reference_id=<supabase_user_id>` in Stripe checkout URL.
- `public.stripe_customer_links` table exists (run latest SQL in `docs/supabase-account-types.sql`).

Verification query:

```sql
select user_id, stripe_customer_id, stripe_subscription_id, updated_at
from public.stripe_customer_links
order by updated_at desc
limit 20;
```

## 17) Web app shows a white page after onboarding redirect

Symptom:

- redirect to `https://haha-app-web.vercel.app/` succeeds
- page stays blank

Cause:

- exported web `index.html` loaded the bundle as classic script
- bundle uses `import.meta`, causing browser bootstrap crash

Fix:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm run deploy:web
```

This rebuilds and patches `dist-web/index.html` with `type="module"` before deployment.

## 18) Redirect to web app asks login again

This is expected when crossing domains (for example `www.ha-ha.ai` -> `haha-app-web.vercel.app`).

Reason:

- Supabase browser session storage is origin-scoped.

Mitigation:

- keep a stable dedicated domain for web app
- avoid unnecessary domain changes (`www` vs non-`www`, preview vs production)

## 19) Stuck after interrupting profile creation and re-clicking confirmation email

Symptom:

- Callback page shows `Validation du compte en cours...`
- Then displays `Email link is invalid or has expired`

Expected behavior:

- This no longer blocks account creation flow.
- Callback screen offers:
  - sign in to resume onboarding/profile creation
  - restart signup to receive a fresh confirmation email

If still blocked:

1. Open `/(auth)/login` and sign in with the same email/password.
2. If password unknown, use `/(auth)/forgot-password`.
3. If signup was never finalized, restart from `/(auth)/signup` and use the newest email link only.

## 20) Subscription plan CTAs are visible but disabled (grey)

Symptom:

- In `/settings/subscription`, `Régulier` / `Premium` buttons appear disabled.

Root cause:

- Missing checkout URLs in app env:
  - `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR`
  - `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM`

Fix:

1. Set both env vars in local `.env` and in Vercel (for web builds).
2. Rebuild/redeploy web app after env changes:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm run deploy:web
```

## 21) `POST /api/stripe-webhook` returns 404

Symptom:

- Stripe event deliveries show `404 ERR` with `The page could not be found`.

Checklist:

- Endpoint URL in Stripe must be exactly:
  - `https://<your-domain>/api/stripe-webhook`
- Destination must point to a running deployed app (not an old/paused domain).
- Re-check Stripe account context (test/sandbox vs live) and webhook destination environment.

## 22) `Cannot find native module 'ExpoSpeechRecognition'` on iOS simulator

Symptom:

- Red screen appears immediately after launch in simulator.

Cause:

- Native module requires a dev build; Expo Go/runtime mismatch or stale native build.

Fix:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx expo run:ios
```

If issue persists:

1. Clean/rebuild app binary.
2. Ensure dependency is installed (`expo-speech-recognition`) and native project is regenerated.
3. Relaunch Metro with cache clear (`npx expo start -c`).

## 23) Detox E2E hangs with "The app is busy" (native timer loop)

Symptom:

- Detox waits indefinitely with repeated "Run loop is awake / native timers" logs.

Fix strategy used in this repo:

- Disable Detox synchronization for this suite launch path.
- Ensure iOS permissions are pre-granted in `device.launchApp(...)`.
- Use current `testID`s (`chat-discussion-button` instead of deprecated send ID).

Run commands:

```bash
npm run e2e:build:ios
npm run e2e:ios
```
