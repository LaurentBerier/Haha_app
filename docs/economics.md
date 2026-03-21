# Unit Economics (Current Strategy)

Last updated: **2026-03-20**

## Scope

This document tracks the current pricing/usage strategy implemented in the app and API.

## Current Plans

| Tier | Price | Text cap (`messagesCap`) | Voice cap (`tts/month`) | Voice rate-limit |
| --- | ---: | ---: | ---: | --- |
| free | $0.00 | 200 | 80 | 20 req/min |
| regular | $8.99 | 3000 | 2000 | 60 req/min |
| premium | $19.99 | 25000 | 20000 | 180 req/min |
| admin | n/a | unlimited | unlimited (configurable) | higher internal ceiling |

Artist pool share:

- `15%` of gross subscription revenue (paid tiers).

## Degradation Strategy (Implemented)

The backend uses multi-threshold degradation before hard block.

API behavior in [`api/claude.js`](/Users/laurentbernier/Documents/HAHA_app/api/claude.js):

1. `normal` mode (`<75%`)
- primary model: `claude-sonnet-4-6`
- tier max tokens: `free=150`, `regular=200`, `premium=300`
- context window by tier: `free=5`, `regular=15`, `premium=20`, `admin=20`

2. `soft1` mode (`>=75%`)
- model: keeps `claude-sonnet-4-6`
- reduced max tokens:
  - `free=120`, `regular=180`, `premium=280`
- reduced context window:
  - `free=5`, `regular=12`, `premium=20`

3. `soft2` mode (`>=90%`)
- model fallback: `claude-haiku-4-5-20251001`
- reduced max tokens:
  - `free=80`, `regular=130`, `premium=200`
- reduced context window:
  - `free=3`, `regular=7`, `premium=12`

4. `economy` mode (`>=100%`)
- model stays on Haiku
- max tokens clamped to `100`
- context window reduced to `3`

5. Hard block behavior
- `free`: blocked at `>=100%` usage ratio
- `regular`/`premium`: blocked at `>=150%` usage ratio (`absolute` threshold)

Response header exposes the active mode:

- `X-Quota-Mode: normal | soft1 | soft2 | economy | blocked`

## Revenue Baseline (Paid Tiers)

Formula:

- `artist_pool = price * 0.15`
- `stripe_fee ~= price * 0.029 + 0.30`
- `net_after_pool_and_fees = price - artist_pool - stripe_fee`

Estimated net (before infra/model/voice costs):

- `regular`: about `$7.08`
- `premium`: about `$16.11`

## Cost-Control Notes

- The graceful degradation path protects UX before block thresholds, but still requires cost monitoring.
- Voice and media features can dominate cost depending on usage mix.
- `impro-themes` currently allows generation even when monthly chat cap is exceeded; this is a deliberate UX choice but should be tracked as an overage vector.

## Required Monitoring KPIs

Track at least:

- `softCapReached` rate by tier
- `economyMode` rate by tier
- average messages/user/month by tier
- model mix ratio (`sonnet` vs `haiku`)
- Stripe net revenue vs variable inference/voice costs

## Guardrails

If margin drops below target for 2 consecutive billing cycles:

1. tighten cap overrides (`CLAUDE_MONTHLY_CAP_*`) by tier
2. lower soft-cap token clamp
3. reduce context windows for high-cost tiers/features
4. gate expensive non-chat endpoints behind stricter quotas

## Source of Truth

- Plan caps in client config: [`src/config/accountTypes.ts`](/Users/laurentbernier/Documents/HAHA_app/src/config/accountTypes.ts)
- Runtime quota logic: [`api/claude.js`](/Users/laurentbernier/Documents/HAHA_app/api/claude.js)
- Usage summary payload: [`api/usage-summary.js`](/Users/laurentbernier/Documents/HAHA_app/api/usage-summary.js)
