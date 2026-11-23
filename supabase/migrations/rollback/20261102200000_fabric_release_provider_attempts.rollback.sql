alter table public.order_fabric_candidates
  drop constraint if exists order_fabric_candidates_provider_attempt_number_check;

alter table public.order_fabric_candidates
  drop column if exists provider_attempt_number;
