# Unit Economics (Current Strategy)

Last updated: **2026-03-07**

## Scope

This document evaluates viability for the current business configuration:

- `free`: $0/month, 15 messages, text only
- `regular`: $8.99/month, 45 messages, ElevenLabs voice
- `premium`: $19.99/month, 110 messages, ElevenLabs voice
- `admin`: unlimited (internal use)

Artist pool share:

- `15%` of gross subscription revenue for all paid tiers.

## Cost Model Assumptions

Operational variable cost assumptions (per message):

- LLM text generation: `$0.007`
- ElevenLabs voice generation: `$0.122`
- Paid-tier voice message total variable cost: `$0.129` per message

Additional operational assumptions:

- Payment processing estimate (Stripe): `2.9% + $0.30` per successful charge.
- Infra/support fixed overhead is excluded from per-user variable margin (tracked separately).

Notes:

- These are planning assumptions and should be reviewed monthly against real invoices.
- Taxes, refunds, failed payments, and churn are not included in the baseline tables.

## Revenue Per Subscriber (After Artist Pool and Payment Fees)

Formula:

- `artist_pool = price * 0.15`
- `payment_fee = price * 0.029 + 0.30`
- `net_revenue_after_shares_and_fees = price - artist_pool - payment_fee`

Results:

- `regular`: `8.99 - 1.3485 - 0.56071 = $7.08079`
- `premium`: `19.99 - 2.9985 - 0.87971 = $16.11179`

## Full-Cap Margin Check

Formula:

- `full_cap_variable_cost = cap_messages * 0.129`
- `contribution_margin_before_fixed = net_revenue_after_shares_and_fees - full_cap_variable_cost`

Results:

| Tier | Net revenue after pool+fees | Full-cap variable cost | Contribution margin before fixed |
|---|---:|---:|---:|
| regular (45) | $7.08079 | $5.805 | **$1.27579** |
| premium (110) | $16.11179 | $14.19 | **$1.92179** |

Conclusion:

- With caps set to `45/110`, current prices become contribution-positive even near full-cap usage.
- Margins remain thin, so overage strategy and usage monitoring are still required.

## Break-Even Message Thresholds

Formula:

- `break_even_messages = net_revenue_after_shares_and_fees / 0.129`

Results:

- `regular`: `~54.9` messages/month
- `premium`: `~124.9` messages/month

Interpretation:

- `regular` cap (`45`) is below break-even threshold (`54.9`), leaving a buffer of `~9.9` messages.
- `premium` cap (`110`) is below break-even threshold (`124.9`), leaving a buffer of `~14.9` messages.

## Decision (Adopted)

- Keep prices at `$8.99` / `$19.99`.
- Use ElevenLabs for paid-tier voice.
- Set monthly caps to:
  - `regular`: `45`
  - `premium`: `110`
- Keep artist pool share fixed at `15%` for all paid tiers.
- Introduce optional overage packs to protect margin while preserving user experience.

## Operational Guardrails

- Track `messagesUsed` and effective cost by tier daily.
- Add alerts when average paid-tier usage exceeds:
  - `regular`: `40` messages
  - `premium`: `100` messages
- Revisit caps/pricing when invoice effective `cost_per_message` changes by >10%.
