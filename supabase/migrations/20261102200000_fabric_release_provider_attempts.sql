alter table public.order_fabric_candidates
  add column if not exists provider_attempt_number integer not null default 1;

alter table public.order_fabric_candidates
  drop constraint if exists order_fabric_candidates_provider_attempt_number_check;

alter table public.order_fabric_candidates
  add constraint order_fabric_candidates_provider_attempt_number_check
  check (provider_attempt_number >= 1);

comment on column public.order_fabric_candidates.provider_attempt_number is
  'Monotonic provider-transfer attempt number. It advances only after a definite rejection or a reconciliation that proves no transfer exists.';
