-- Record the provider readiness observation used immediately before a reviewed payout release.
alter table public.money_desk_execution_attempts
  add column if not exists provider_readiness_checked_at timestamptz;

comment on column public.money_desk_execution_attempts.provider_readiness_checked_at is
  'Fresh provider capability observation recorded before the payout claim RPC; null for actions without a Stripe release refresh.';
