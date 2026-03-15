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
- `ELEVENLABS_FETCH_TIMEOUT_MS`
- `TTS_RATE_LIMIT_WINDOW_MS`
- `TTS_RATE_LIMIT_MAX_REQUESTS`
- `TTS_MONTHLY_CAP_REGULAR`
- `TTS_MONTHLY_CAP_PREMIUM`

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

1. Confirm user tier is paid (`regular`, `premium`, or `admin`).
2. Check `/api/tts` authenticated smoke (`SMOKE_AUTH_TOKEN=...`).
3. If API fails, inspect Vercel logs for `api/claude` and `api/tts` proxy path.

### Symptom: play button visible but no sound

1. Inspect response status and content type (`audio/mpeg`).
2. On web, validate browser autoplay policy and user gesture.
3. On native, verify `expo-av` playback state and cached file write success.

### Symptom: frequent `TTS_QUOTA_EXCEEDED`

1. Verify tier and monthly usage in `usage_events` where `endpoint='tts'`.
2. Adjust caps via env if needed (`TTS_MONTHLY_CAP_REGULAR`, `TTS_MONTHLY_CAP_PREMIUM`).

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
