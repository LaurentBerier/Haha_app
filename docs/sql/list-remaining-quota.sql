-- List remaining monthly quota for one user
-- Usage:
-- 1) Open Supabase SQL Editor
-- 2) Replace TARGET_USER_ID below
-- 3) Run query

with input as (
  select
    'TARGET_USER_ID'::uuid as user_id,
    date_trunc('month', now()) as month_start,
    date_trunc('month', now()) + interval '1 month' as next_reset_at
),
caps as (
  select *
  from (
    values
      ('free'::text, 200::int),
      ('regular'::text, 3000::int),
      ('premium'::text, 25000::int),
      ('admin'::text, null::int)
  ) as t(account_type_id, messages_cap)
),
profile_data as (
  select
    p.id as user_id,
    coalesce(nullif(p.account_type_id, ''), 'free') as account_type_id,
    coalesce(p.monthly_message_count, 0) as monthly_message_count,
    p.monthly_reset_at
  from public.profiles p
  join input i on i.user_id = p.id
),
usage_events_count as (
  select
    i.user_id,
    count(ue.id)::int as usage_events_used
  from input i
  left join public.usage_events ue
    on ue.user_id = i.user_id
   and ue.endpoint = 'claude'
   and ue.created_at >= i.month_start
  group by i.user_id
),
computed as (
  select
    pd.user_id,
    pd.account_type_id,
    c.messages_cap,
    pd.monthly_message_count as used_profile_counter,
    uec.usage_events_used as used_usage_events,
    greatest(pd.monthly_message_count, uec.usage_events_used) as used_effective,
    i.next_reset_at,
    case
      when c.messages_cap is null then null
      else greatest(c.messages_cap - greatest(pd.monthly_message_count, uec.usage_events_used), 0)
    end as remaining_messages,
    case
      when c.messages_cap is null then null
      when c.messages_cap = 0 then 0
      else round((greatest(pd.monthly_message_count, uec.usage_events_used)::numeric / c.messages_cap::numeric) * 100, 1)
    end as used_percent
  from profile_data pd
  join input i on i.user_id = pd.user_id
  left join caps c on c.account_type_id = pd.account_type_id
  left join usage_events_count uec on uec.user_id = pd.user_id
)
select
  user_id,
  account_type_id,
  messages_cap,
  used_profile_counter,
  used_usage_events,
  used_effective,
  remaining_messages,
  used_percent,
  case
    when messages_cap is null then 'unlimited'
    when account_type_id = 'free' and used_effective >= messages_cap then 'blocked (free >=100%)'
    when account_type_id <> 'free' and used_effective >= ceil(messages_cap * 1.50) then 'blocked (paid >=150%)'
    when used_effective >= messages_cap then 'economy (>=100%)'
    when used_effective >= ceil(messages_cap * 0.90) then 'soft2 (>=90%)'
    when used_effective >= ceil(messages_cap * 0.75) then 'soft1 (>=75%)'
    else 'normal'
  end as quota_mode,
  next_reset_at
from computed;
