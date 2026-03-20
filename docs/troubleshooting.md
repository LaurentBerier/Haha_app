# Troubleshooting

## 0) Wrong Vercel project or scope used for this repo

Symptoms:

- Deploy succeeds but app/API behavior does not match expected production.
- CORS or env behavior looks inconsistent with `https://app.ha-ha.ai`.

Required target for this repository:

- Team/scope: `snadeau-breakingwalls-projects`
- Project: `haha-app`
- Never deploy this repo from `lbernier-2067s-projects`.

Fix:

```bash
npm run vercel:link:app
npm run deploy:web
```

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
  - `hahaha://auth/callback?flow=recovery`
  - `https://app.ha-ha.ai/auth/callback`
  - `https://haha-app-delta.vercel.app/auth/callback` (optional preview/alias)

Email template requirement (critical):

- Use `{{ .ConfirmationURL }}` for confirmation/reset links.
- Do not build links manually with `{{ .SiteURL }}/auth/callback?token_hash=...`.

User guidance:

- After signup, users should be told to check spam/junk for the Ha-Ha.ai confirmation email.
- If callback opens with an expired/invalid link, the app now shows recovery actions:
  - `Se connecter pour reprendre`
  - `Recommencer l'inscription`

Validation tip:

- In the received email link, confirm `redirect_to=` points to `hahaha://auth/callback` (URL-encoded).
- If not, update template/config and send a brand new confirmation email.

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

Important scope:

- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are app/env vars (Expo local + web build), not backend-only Vercel secrets.

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

Check that [`.vercelignore`](/Users/laurentbernier/Documents/HAHA_app/.vercelignore) does not exclude required deploy files:

- `api/**`
- `src/**`
- `scripts/exportWeb.mjs`
- `package.json` and `package-lock.json`
- `vercel.json`

Redeploy:

```bash
npx vercel --prod --yes --scope snadeau-breakingwalls-projects
```

## 7) `/api/claude` returns 500 instead of 401/403

Verify Vercel env vars:

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- if request comes from a browser origin: `ALLOWED_ORIGINS` must include that origin

Auth smoke tests:

```bash
# 1) Missing bearer + no Origin => expected 403 (CORS guard)
curl -i -X POST "https://<alias>.vercel.app/api/claude" \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'

# 2) Invalid bearer => expected 401 (auth guard)
curl -i -X POST "https://<alias>.vercel.app/api/claude" \
  -H "content-type: application/json" \
  -H "authorization: Bearer invalid-token" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

### `/api/tts` blocked by CORS on web (`No 'Access-Control-Allow-Origin' header`)

Checklist:

- `ALLOWED_ORIGINS` in Vercel includes current caller origin (local + production):
  - `https://app.ha-ha.ai`
  - `https://www.ha-ha.ai`
  - `https://ha-ha.ai`
  - `https://*.ha-ha.ai`
  - `http://localhost:*`
  - `http://127.0.0.1:*`
  - `http://localhost:8081`
  - `http://localhost:19006`
- `ELEVENLABS_API_KEY` exists in the `haha-app` Vercel project (server env).
- Deployment is from the correct app project/scope:
  - `snadeau-breakingwalls-projects/haha-app`

Then redeploy:

```bash
# run from /Users/laurentbernier/Documents/HAHA_app (repo root), never from dist-web
npm run deploy:web
```

Validate immediately after deploy:

```bash
npm run smoke:voice
```

Optional authenticated smoke:

```bash
SMOKE_AUTH_TOKEN=<supabase_access_token> npm run smoke:voice
```

Alternative without manual token copy:

```bash
SMOKE_AUTH_EMAIL=<email> SMOKE_AUTH_PASSWORD=<password> npm run smoke:voice
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

Notes:

- Current webhook handlers are backward-compatible during migration rollout:
  - if `provider_event_id` is not present yet, insert automatically retries without that field.
- This avoids immediate production outage, but the SQL migration is still recommended for durable idempotency.

Verify:

```sql
select id, provider, event_type, product_id, created_at
from public.payment_events
order by created_at desc
limit 20;
```

### Additional: web console shows `POST /api/greeting 500` on mode-select

Symptoms:

- On `/mode-select/[artistId]`, greeting still appears, but browser console logs `POST /api/greeting 500`.

Expected behavior:

- Greeting has a fallback path, so UX should continue even if greeting API fails.
- On `localhost`/`127.0.0.1`/`::1`, client intentionally skips greeting API and uses fallback greeting text.

Checks:

1. Hard refresh browser bundle after frontend updates.
2. Confirm host is local if you expect greeting API bypass.
3. In production, verify backend env:
   - `ANTHROPIC_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

Notes:

- Client applies short backoff after greeting API server/network failures.
- Weather uses Open-Meteo and news uses RSS feeds (no weather/news API keys required).

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

Implementation note:

- Webhook verification first uses Stripe SDK `constructEvent(...)` with raw-body signature validation.
- If raw body is unavailable in runtime, webhook falls back to Stripe event lookup by `event.id` using configured Stripe secret keys.

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

- redirect to `https://app.ha-ha.ai/` succeeds
- page stays blank

Cause:

- exported web `index.html` loaded the bundle as classic script
- bundle uses `import.meta`, causing browser bootstrap crash

Fix:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx vercel --prod --yes --scope snadeau-breakingwalls-projects
```

This rebuilds and patches `dist-web/index.html` with `type="module"` before deployment.

## 18) Redirect to web app asks login again

This is expected when crossing domains (for example `ha-ha.ai` landing -> `app.ha-ha.ai` app).

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
npx vercel --prod --yes --scope snadeau-breakingwalls-projects
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
4. Reinstall pods if native project changed:

```bash
cd /Users/laurentbernier/Documents/HAHA_app/ios
pod install
```

Notes:

- `voiceEngine` now guards missing native bindings and logs a warning instead of hard-crashing in many mismatch scenarios.
- A full dev-build reinstall is still required whenever native module linkage is stale.

## 22b) iOS warning: `Audio route changed and failed to restart the audio engine`

Symptom:

- During voice conversation, microphone stops after route changes (speaker/Bluetooth/system interruptions).
- Console or UI may show route-restart error messages.

Status:

- `useVoiceConversation` now includes transient iOS route-recovery retries.
- Many route-change interruptions self-recover without manual toggle.

Manual recovery (if still stuck):

1. Toggle conversation mic off then on in the composer.
2. Ensure iOS microphone permission is still granted for the app.
3. If persistent, relaunch app and retry on built-in route (no Bluetooth) to isolate hardware-route issues.

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

## 24) Vercel build fails with `vercel.json ... should NOT have additional property 'bodyParser'`

Symptom:

- Deployment fails before build starts.
- Error references:
  - ``functions.api/stripe-webhook.js`` and `bodyParser`.

Cause:

- In this repo's Vercel function schema, `bodyParser` is not a supported key under `functions`.

Fix:

1. Remove `bodyParser` from `vercel.json` function config.
2. Keep only supported keys (for example `maxDuration`).
3. Re-run deploy.

Validation command:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx vercel build --yes
```

## 25) Chat replies are generic / unrelated to question

Symptoms:

- Chat bubble shows `Erreur pendant la génération`.
- Console/network shows `Failed to fetch` or `Impossible de joindre le service IA...`.
- Replies can look generic if `USE_MOCK_LLM` was enabled by mistake.

Root causes to check:

- bad/missing proxy base URL (`EXPO_PUBLIC_CLAUDE_PROXY_URL` or `EXPO_PUBLIC_API_BASE_URL`)
- stale model in app env (for example `EXPO_PUBLIC_ANTHROPIC_MODEL=claude-sonnet-4-5-20250929`) while backend accepts only `claude-sonnet-4-6`
- invalid/missing API auth token
- backend quota/rate-limit rejection
- browser origin blocked by `ALLOWED_ORIGINS`

Current behavior:

- automatic fallback from Claude to mock is disabled in normal mode to avoid silent fake answers
- failed Claude requests now surface as errors in chat instead of generic mock output

Fix checklist:

1. Ensure app env uses:
   - `EXPO_PUBLIC_USE_MOCK_LLM=false`
   - `EXPO_PUBLIC_ANTHROPIC_MODEL=claude-sonnet-4-6`
2. Clear cache and restart:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx expo start -c
```

3. Rebuild/redeploy web app after env or code updates:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx vercel --prod --yes --scope snadeau-breakingwalls-projects
```

4. Verify proxy health directly (replace domain):

```bash
curl -i -X POST "https://<your-app-domain>/api/claude" \
  -H "content-type: application/json" \
  -H "authorization: Bearer invalid-token" \
  -d '{"messages":[{"role":"user","content":"salut"}]}'
```

Expected:
- `401 Unauthorized` with invalid bearer token (route reachable)
- note: request without bearer/origin may return `403` first because of CORS guard
- not `404`, not `FUNCTION_INVOCATION_FAILED`

## 26) Chat shows `Rate limit store unavailable.`

Symptoms:

- AI bubble fails with: `Rate limit store unavailable.`

Most likely causes:

- `SUPABASE_SERVICE_ROLE_KEY` is missing/incorrect in Vercel (for example anon key instead of service-role key)
- `usage_events` schema is partially migrated (for example missing columns)

Current mitigation in code:

- Claude API now retries `usage_events` insert without `request_id` when that column is absent.
- If `usage_events` is temporarily unavailable, API uses an in-memory per-user fallback limiter (short-term resilience).

Permanent fix checklist:

1. In Vercel, verify `SUPABASE_SERVICE_ROLE_KEY` is the real service-role key (legacy JWT-style `eyJ...` or secret-style `sb_secret_...`), not the publishable/anon key.
2. Re-run SQL migration:
   - [`docs/supabase-account-types.sql`](/Users/laurentbernier/Documents/HAHA_app/docs/supabase-account-types.sql)
3. Redeploy backend and web.

## 27) Conversation history appears mixed between users

Symptoms:

- After logging into different accounts on the same browser/device, conversations from another user appear.

Current safeguard in code:

- Persisted store now includes `ownerUserId`.
- On auth bootstrap/state sync, account-scoped local data is automatically cleared when user changes.

If you still see old mixed data (usually from older cached builds):

1. Update to latest build, then sign out and sign back in.
2. Clear local cache once:
   - Web: clear Local Storage key `ha-ha-store-v1` and reload.
   - iOS simulator/device dev build: reinstall app or clear app data.
3. Confirm with a fresh login cycle:
   - user A creates a chat
   - sign out
   - user B signs in
   - history for user B should not include user A messages

## 28) iOS crash when opening mode categories (`On Jase?`, `Blagues & Gadgets`, `Jeux`, `Profil`)

Symptom:

- Red screen with:
  - `Attempting to run JS driven animation on animated node that has been moved to "native"...`
- Triggered right after tapping a mode category card.

Cause:

- Same `Animated.View` node received both:
  - color/shadow animations on JS driver (`useNativeDriver: false`)
  - press scale animation on native driver (`useNativeDriver: true`)

Fix in code:

- File: [`src/app/mode-select/[artistId]/index.tsx`](/Users/laurentbernier/Documents/HAHA_app/src/app/mode-select/[artistId]/index.tsx)
- Category-card press animations now also use `useNativeDriver: false` to keep one driver per node.

If you still hit it on device:

1. Rebuild/reinstall the iOS app:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx expo run:ios --device
```

2. Restart Metro with clean cache:

```bash
npx expo start -c
```

3. Open the app and retest category navigation.

## 29) `Themes generes localement` in `Histoire improvisee`

Symptom:

- In `/games/[artistId]/impro-chain`, the lobby displays `Themes generes localement`.

What it means:

- The app failed to fetch personalized themes from `POST /api/impro-themes`.
- It automatically falls back to the local theme pool so the game remains usable.

Most common causes:

- `ANTHROPIC_API_KEY` missing/invalid in Vercel.
- `SUPABASE_SERVICE_ROLE_KEY` missing/invalid in Vercel.
- browser `Origin` blocked by `ALLOWED_ORIGINS`.
- temporary upstream/API error on Anthropic.

Checks:

1. Confirm app env points to the app API domain:
   - `EXPO_PUBLIC_API_BASE_URL=https://app.ha-ha.ai/api`
   - `EXPO_PUBLIC_CLAUDE_PROXY_URL=https://app.ha-ha.ai/api/claude`
2. In browser DevTools Network, inspect `POST /api/impro-themes` response code/body.
3. In Vercel logs, verify no `SERVER_MISCONFIGURED` / `UPSTREAM_ERROR` for `api/impro-themes`.
4. Use `Regenerer les themes` after fixing env values.

## 30) Stripe pre-deploy checklist (test/live)

Use this before testing or shipping subscription changes:

1. App env mode and checkout URLs:
   - `EXPO_PUBLIC_STRIPE_MODE=live` or `test`
   - live links: `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR`, `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM`
   - test links: `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR_TEST`, `EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM_TEST`
2. Backend Stripe secrets in Vercel:
   - live: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`
   - test: `STRIPE_WEBHOOK_SECRET_TEST`, `STRIPE_SECRET_KEY_TEST`
3. Mapping vars are complete:
   - live: `STRIPE_PAYMENT_LINK_ID_*`, `STRIPE_PRICE_ID_*`
   - test: `STRIPE_PAYMENT_LINK_ID_*_TEST`, `STRIPE_PRICE_ID_*_TEST`
4. Webhook destination is exact:
   - `https://app.ha-ha.ai/api/stripe-webhook`
5. Enabled Stripe events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
6. Redeploy after env changes:
   - `npx vercel --prod --yes --scope snadeau-breakingwalls-projects`
7. Validate with Stripe event resend and expect `200 OK`.

## 31) Mic looks active but stops capturing after a few turns

Symptoms:

- Mic icon stays on, but Cathy no longer receives voice input.
- User can sometimes pause mic, but resume appears ineffective.

Current behavior to expect:

- Voice controller uses bounded recovery retries for transient STT endings: `250ms`, `800ms`, `2000ms`.
- After recovery budget is exhausted, mic enters `paused_recovery` and waits for explicit user tap.

Checks:

1. Read hint text above composer:
   - `Micro en pause - touche pour reprendre` => manual pause (`paused_manual`)
   - `Micro interrompu - touche pour relancer` => recovery pause (`paused_recovery`)
2. Ensure no blocking condition prevents restart:
   - Cathy audio currently playing/loading
   - typed draft present in composer
   - conversation disabled or quota-blocked
3. On web, confirm STT support exists (`SpeechRecognition` or `webkitSpeechRecognition` available).
4. In dev, inspect logs:
   - `[useVoiceConversation] session_end`
   - `[useVoiceConversation] recovery_scheduled`
   - `[useVoiceConversation] state_transition`

## 32) Mic does not auto-start after greeting/tutorial on first load

Symptoms:

- Greeting bubble appears but mic remains inactive until user toggles it manually.

Current behavior:

- Mode-select greeting/tutorial should arm mic automatically once per greeting `messageId`.
- Manual user pause during greeting cancels forced auto-start for that greeting.

Checks:

1. Confirm conversation mode is enabled.
2. Confirm conversation is valid and not quota-blocked.
3. Confirm no typed draft is active when greeting is injected.
4. If testing web, hard refresh to avoid stale bundle (old bundles may keep outdated mic bootstrap behavior).

## 33) Cathy text appears but no voice is heard

Symptoms:

- Artist bubble is complete but no audible output.
- Replay button may be absent or voice may fail on replay.

Checks:

1. Inspect `/api/tts` calls in network tab:
   - `200` => audio should be available
   - `403`/`429` => tier/quota/rate limit may block voice output
2. Confirm account tier (`regular`, `premium`, or `admin`) and valid session token.
3. Verify `ELEVENLABS_API_KEY` is configured in Vercel project `haha-app`.
4. On web, verify autoplay restriction path:
   - greeting audio may require first user gesture before playback
   - replay button should still appear once voice metadata reaches `ready`

## 34) Mic pause does not persist (auto-resumes unexpectedly)

Symptoms:

- User taps mic to pause, hint appears, then mic resumes without user action.

Current expected behavior:

- Manual pause must persist until explicit resume tap.
- Auto-recovery and auto-listen must not override `paused_manual`.

Checks:

1. Validate the build is current (includes manual pause precedence in `useVoiceConversation` state machine).
2. Confirm UI uses dedicated pause/resume callbacks (`onPauseListening` / `onResumeListening`) instead of generic interrupt toggle.
3. Verify all surfaces behave the same:
   - chat screen
   - mode-select conversation
   - global dock input
