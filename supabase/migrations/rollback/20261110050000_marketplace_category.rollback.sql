do $$
begin
  if exists (select 1 from public.tailor_profiles where marketplace_category <> 'TAILORING'::public.marketplace_category)
    or exists (select 1 from public.marketplace_category_decisions)
  then
    raise exception 'Rollback refused: marketplace category decisions exist. Restore all profiles to TAILORING and retain or explicitly archive the decision history first.';
  end if;
end;
$$;

drop function if exists public.ops_set_marketplace_category(uuid, public.marketplace_category, text, text, text);
drop trigger if exists trg_guard_tailor_marketplace_category on public.tailor_profiles;
drop function if exists public.guard_tailor_marketplace_category();
drop table if exists public.marketplace_category_decisions;
drop index if exists public.tailor_profiles_public_category_rank_idx;
alter table public.tailor_profiles drop column if exists marketplace_category;
drop type if exists public.marketplace_category;
