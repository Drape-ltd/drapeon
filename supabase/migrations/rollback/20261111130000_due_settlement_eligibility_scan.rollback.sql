-- Roll back the scheduler migration first, then this selector and scan marker.
drop function if exists public.list_due_settlement_eligibility_plans(integer);
drop index if exists public.order_settlement_plans_eligibility_scan_idx;
alter table public.order_settlement_plans
  drop column if exists last_eligibility_scan_at;
