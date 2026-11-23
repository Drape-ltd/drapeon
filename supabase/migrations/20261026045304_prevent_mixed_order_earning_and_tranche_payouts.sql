-- One order may be paid through ordinary legacy release OR staged tranches,
-- never both. Serialize concurrent inserts/route changes by order before the
-- cross-purpose check so two releasers cannot race past the invariant.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.guard_order_payout_policy_exclusivity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_conflicting_purpose text;
begin
  if new.order_id is null
    or new.payout_purpose not in ('ORDER_EARNING', 'SETTLEMENT_TRANCHE') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.order_id::text, 0)
  );

  v_conflicting_purpose := case new.payout_purpose
    when 'ORDER_EARNING' then 'SETTLEMENT_TRANCHE'
    else 'ORDER_EARNING'
  end;

  if exists (
    select 1
    from public.payouts existing
    where existing.order_id = new.order_id
      and existing.id is distinct from new.id
      and existing.payout_purpose = v_conflicting_purpose
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'payouts_order_earning_tranche_exclusive',
      message = 'An order cannot mix ordinary earning and staged-tranche payouts';
  end if;

  return new;
end
$function$;

revoke all on function private.guard_order_payout_policy_exclusivity()
  from public, anon, authenticated;
grant execute on function private.guard_order_payout_policy_exclusivity()
  to service_role;

drop trigger if exists payouts_order_earning_tranche_exclusive
  on public.payouts;
create trigger payouts_order_earning_tranche_exclusive
before insert or update of order_id, payout_purpose on public.payouts
for each row
execute function private.guard_order_payout_policy_exclusivity();

comment on function private.guard_order_payout_policy_exclusivity() is
  'Prevents the same order from receiving both ORDER_EARNING and SETTLEMENT_TRANCHE payouts, including concurrent attempts.';
