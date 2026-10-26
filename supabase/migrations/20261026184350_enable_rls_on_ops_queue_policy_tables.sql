-- Ops policy data is read server-side with the service-role client. Keep the
-- public-schema tables behind RLS with no client policies; preserve the
-- existing grants exactly as they are.
alter table public.ops_coverage_calendars enable row level security;
alter table public.ops_queue_policies enable row level security;
