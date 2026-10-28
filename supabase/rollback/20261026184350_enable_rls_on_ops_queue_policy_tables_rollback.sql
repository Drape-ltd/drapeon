-- Restore the previous RLS-disabled state. Grants are intentionally untouched.
alter table public.ops_coverage_calendars disable row level security;
alter table public.ops_queue_policies disable row level security;
