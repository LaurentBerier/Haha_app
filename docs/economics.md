# Unit Economics (Current Strategy)

Last updated: **2026-03-13**

## Scope

This document tracks the current pricing/usage strategy implemented in the app and API.

## Current Plans

| Tier | Price | Monthly cap (`messagesCap`) | Quota behavior |
| --- | ---: | ---: | --- |
| free | $0.00 | 40 | soft-cap + economy mode |
| regular | $8.99 | 300 | soft-cap + economy mode |
| premium | $19.99 | 600 | soft-cap + economy mode |
| admin | n/a | unlimited | no quota cap |

Artist pool share:

- `15%` of gross subscription revenue (paid tiers).

## Degradation Strategy (Implemented)

The backend no longer hard-stops chat at cap. It degrades quality/cost instead.

API behavior in [`api/claude.js`](/Users/laurentbernier/Documents/HAHA_app/api/claude.js):

1. `normal` mode (`<80%`)
- primary model: `claude-sonnet-4-6`
- tier max tokens: `free=150`, `regular=200`, `premium=300`
- context window by tier: `free=5`, `regular=15`, `premium=20`, `admin=20`

2. `soft-cap` mode (`>=80%`)
- model fallback: `claude-haiku-4-5-20251001`
- max tokens clamped to `150`

3. `economy` mode (`>=100%`)
- model stays on Haiku
- max tokens clamped to `100`
- context window reduced to `5`

Response header exposes the active mode:

- `X-Quota-Mode: normal | soft-cap | economy`

## Revenue Baseline (Paid Tiers)

Formula:

- `artist_pool = price * 0.15`
- `stripe_fee ~= price * 0.029 + 0.30`
- `net_after_pool_and_fees = price - artist_pool - stripe_fee`

Estimated net (before infra/model/voice costs):

- `regular`: about `$7.08`
- `premium`: about `$16.11`

## Cost-Control Notes

- The graceful degradation path protects UX (no hard chat block) but requires cost monitoring.
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
