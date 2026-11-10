alter table public.money_desk_execution_attempts
  drop column if exists provider_readiness_checked_at;
