revoke all on table public.marketplace_category_decisions
  from public, anon, authenticated;
grant select, insert on table public.marketplace_category_decisions to service_role;

create index if not exists marketplace_category_decisions_profile_created_idx
  on public.marketplace_category_decisions (tailor_profile_id, created_at desc);

revoke execute on function public.guard_tailor_marketplace_category()
  from public, anon, authenticated;
grant execute on function public.guard_tailor_marketplace_category() to service_role;

comment on table public.marketplace_category_decisions is
  'Ops placement history. Service-role only; RLS stays enabled with no policies so client roles read nothing.';
