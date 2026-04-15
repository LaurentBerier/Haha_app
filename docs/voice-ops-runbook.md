# Voice Ops Runbook (ElevenLabs TTS)

## 1) Mandatory Deployment Target

This app repo must deploy to:

- Vercel scope/team: `snadeau-breakingwalls-projects`
- Vercel project: `haha-app`

Do not deploy this repo in `lbernier-2067s-projects`.

## 2) Required Runtime Configuration

### Client/app env

- `EXPO_PUBLIC_API_BASE_URL=https://app.ha-ha.ai/api`
- `EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC=<voice_id>`
- `EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY=<voice_id or empty>`

### Vercel server env (`haha-app`)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS`
- `ELEVENLABS_API_KEY`

Recommended optional tuning:

- `ELEVENLABS_MODEL_ID`
- `ELEVENLABS_VOICE_ID_GENERIC`
- `ELEVENLABS_VOICE_ID_CATHY`
- `ELEVENLABS_USE_CATHY_FOR_ALL_PAID`
- `ELEVENLABS_FETCH_TIMEOUT_MS`
- `TTS_RATE_LIMIT_WINDOW_MS`
- `TTS_RATE_LIMIT_MAX_REQUESTS`
- `TTS_RATE_LIMIT_MAX_REQUESTS_FREE`
- `TTS_RATE_LIMIT_MAX_REQUESTS_REGULAR`
- `TTS_RATE_LIMIT_MAX_REQUESTS_PREMIUM`
- `TTS_MONTHLY_CAP_FREE`
- `TTS_MONTHLY_CAP_REGULAR`
- `TTS_MONTHLY_CAP_PREMIUM`

Model switch aliases supported by the API:

- v3: `eleven_v3`, `v3`, `3`
- v2.5 turbo: `eleven_turbo_v2_5`, `v2.5`, `2.5`

### Web TTS endpoint order (client failover)

`src/services/ttsService.ts` tries endpoints in this order:

1. `<window.origin>/api/tts`
2. `/api/tts`
3. `${EXPO_PUBLIC_API_BASE_URL}/tts`
4. `${EXPO_PUBLIC_CLAUDE_PROXY_URL}` rewritten from `/claude` to `/tts`

Notes:

- each candidate uses an `AbortController` timeout (`10s`) before failing over
- partial candidate failures (timeout/CORS/network) do not stop fallback sequence
- terminal API statuses (`401/403/429`) stop failover and return structured error codes immediately
- TTS requests now pass conversation-language hints:
  - provider receives ISO `language_code` when supported
  - handler retries once without `language_code` on provider locale-validation failures (`400/422`)

## 3) CORS Allowlist Baseline

`ALLOWED_ORIGINS` should include at minimum:

- `https://app.ha-ha.ai`
- `https://www.ha-ha.ai`
- `https://ha-ha.ai`
- `https://*.ha-ha.ai`
- `http://localhost:*`
- `http://127.0.0.1:*`
- `http://localhost:8081`
- `http://localhost:19006`

## 4) Deploy Procedure (from repo root)

Run from `/Users/laurentbernier/Documents/HAHA_app`:

```bash
npm run deploy:web
```

This command already validates the Vercel link (`haha-app`) before deploying.

## 5) Post-Deploy Smoke Checks

Quick full QA (Phase 2/3):

```bash
npm run qa:phase23
```

CI guardrail:

- GitHub workflow [`.github/workflows/phase23-ci.yml`](/Users/laurentbernier/Documents/HAHA_app/.github/workflows/phase23-ci.yml) runs on `main` and PRs.
- Actions versions are pinned to Node24-compatible releases (`actions/checkout@v6`, `actions/setup-node@v6`).

### Anonymous and CORS contract

```bash
npm run smoke:voice
```

Expected outcomes:

- `tts preflight` => `204`
- `tts no auth` => `401`

### Authenticated voice probe

```bash
SMOKE_AUTH_TOKEN=<supabase_access_token> npm run smoke:voice
```

Expected `tts with auth` status: `200`, `403`, or `429` depending on tier/quota.

Alternative (auto-token via Supabase password login):

```bash
SMOKE_AUTH_EMAIL=<email> \
SMOKE_AUTH_PASSWORD=<password> \
npm run smoke:voice
```

## 6) Incident Triage

### Symptom: web console shows CORS error on `/api/tts`

1. Verify request origin is included in `ALLOWED_ORIGINS`.
2. Confirm deploy target was `snadeau-breakingwalls-projects/haha-app`.
3. Redeploy from repo root and re-run `npm run smoke:voice`.

### Symptom: play button missing

1. Confirm user tier has voice entitlement (`free`, `regular`, `premium`, or `admin`) and that the tier is under monthly voice cap.
2. Check `/api/tts` authenticated smoke (`SMOKE_AUTH_TOKEN=...`).
3. If API fails, inspect Vercel logs for `api/claude` and `api/tts` proxy path.
4. In message metadata, inspect `voiceStatus`:
   - `ready`: replay should be enabled
   - `generating`: loading waveform is expected
   - `unavailable`: disabled control + reason + retry action should appear
5. If control is `unavailable`, trigger retry from bubble CTA and verify transition `unavailable -> generating -> ready`.

### Symptom: play button visible but no sound

1. Inspect response status and content type (`audio/mpeg`).
2. On web, validate browser autoplay policy and user gesture.
3. On native, verify `expo-av` playback state and cached file write success.

### Symptom: text appears but Cathy does not speak

1. Check network for `/api/tts` status:
   - `429` / `403` can produce text-only replies when voice fallback also fails.
2. Verify user tier (`free`, `regular`, `premium`, or `admin`) and `ELEVENLABS_API_KEY`.
3. Confirm client has valid bearer token (expired auth token can make voice status become `unavailable` with auth-related code).
4. Validate `voiceErrorCode` on affected message metadata to distinguish:
   - rate limit
   - quota exceeded
   - forbidden/auth
   - generic provider failure

### Symptom: Cathy answers in the right language but voice sounds in a different locale

1. Inspect message/conversation language in state:
   - conversation language is the source of truth for STT/TTS locale routing.
   - auto-detected language candidates do not switch immediately; a yes/no confirmation message must be resolved first.
2. Validate TTS request body in network:
   - first attempt should include `language_code` when language prefix is supported.
3. If first attempt returns provider locale error (`400/422`), confirm second upstream call is sent without `language_code`.
4. For STT startup failures on uncommon locales:
   - expected behavior is one fallback retry using app locale (`fr-CA`/`en-CA`).
   - verify this path in logs before assuming microphone entitlement issues.

### Symptom: frequent `TTS_QUOTA_EXCEEDED`

1. Verify tier and monthly usage in `usage_events` where `endpoint='tts'`.
2. Check default caps:
   - free: `80/month`
   - regular: `2000/month`
   - premium: `20000/month`
3. Adjust caps via env if needed (`TTS_MONTHLY_CAP_FREE`, `TTS_MONTHLY_CAP_REGULAR`, `TTS_MONTHLY_CAP_PREMIUM`).

### Symptom: mic appears on but stops capturing after repeated turns

1. Check `micState` hint shown above composer:
   - `paused_manual`: user paused manually, tap mic to resume
   - `paused_recovery`: retry budget exhausted, tap mic to restart
   - `unsupported`: browser STT unavailable
2. In dev logs, inspect `[useVoiceConversation] state_transition` and `session_end` events.
3. Confirm no blocking condition is active:
   - assistant speaking/loading
   - typed draft in composer
   - quota-blocked conversation
4. Expected recovery policy:
   - transient retries at `250ms`, `800ms`, `2000ms`
   - then explicit `paused_recovery` (no infinite hidden retries)
5. Native iOS/mobile post-playback startup caveat:
   - startup/transient ends that happen right after assistant playback are handled by a dedicated bounded startup-retry lane
   - this path should keep auto-recovering and must not jump immediately to `paused_recovery`
   - startup retry lane resets after first real STT result

### Symptom: Cathy reply audio stops before the full text is spoken

1. Inspect artist message metadata:
   - `voiceQueue` should contain all playable chunks for that reply
   - `voiceChunkBoundaries` last value should match final visible text length
2. If early chunks exist but a later chunk failed, expected behavior is:
   - keep successful chunk URIs
   - synthesize a tail-rescue segment from last valid boundary to end of text
   - append tail-rescue URI into replay/autoplay queue
3. If no chunk is usable at all, expected fallback is a full-text synthesis attempt.
4. Terminal provider/auth/quota statuses (`401/403/429`, explicit terminal codes) can still produce text-only fallback with `voiceStatus='unavailable'`.

## 7) Logs and Correlation

- API errors include a request ID in standard error envelope.
- For triage, correlate client-side failing request timestamp with Vercel function logs.
- `/api/tts` is served via route proxy to `api/claude.js` with `__proxy=tts`; inspect `api/claude` logs plus TTS handler logs.

## 8) SQL Checks

Monthly per-user TTS usage:

```sql
select user_id, count(*) as tts_calls
from public.usage_events
where endpoint = 'tts'
  and created_at >= date_trunc('month', now())
group by user_id
order by tts_calls desc
limit 50;
```

Spot check one user:

```sql
select created_at, endpoint, request_id
from public.usage_events
where user_id = '<uuid>'
  and endpoint = 'tts'
order by created_at desc
limit 100;
```
