-- Development-only performance repair, recorded by the Development migration
-- runner as version 20261124034830. The claim boundary remains exactly as
-- restrictive, but its SECURITY DEFINER helper is evaluated once per statement
-- as an initPlan instead of once for every row scanned.

drop policy if exists deny_staff_draft_claim_session on realtime.messages;
create policy deny_staff_draft_claim_session on realtime.messages
  as restrictive for all to authenticated
  using (not (select public.is_staff_draft_identity()))
  with check (not (select public.is_staff_draft_identity()));

do $policy$
declare target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists deny_staff_draft_claim_session on %I.%I', target.schema_name, target.table_name);
    execute format(
      'create policy deny_staff_draft_claim_session on %I.%I as restrictive for all to authenticated using (not (select public.is_staff_draft_identity())) with check (not (select public.is_staff_draft_identity()))',
      target.schema_name, target.table_name
    );
  end loop;
end
$policy$;

do $coverage$
declare v_missing text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by n.nspname, c.relname)
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
    and not exists (
      select 1 from pg_policy p
      where p.polrelid = c.oid
        and p.polname = 'deny_staff_draft_claim_session'
        and pg_get_expr(p.polqual, p.polrelid) ~* 'not[[:space:]]*[(][[:space:]]*select[[:space:]]+(public[.])?is_staff_draft_identity[(][)]'
        and pg_get_expr(p.polwithcheck, p.polrelid) ~* 'not[[:space:]]*[(][[:space:]]*select[[:space:]]+(public[.])?is_staff_draft_identity[(][)]'
    );
  if v_missing is not null then
    raise exception 'STAFF_DRAFT policy coverage missing or not initPlan-wrapped: %', v_missing;
  end if;
end
$coverage$;
