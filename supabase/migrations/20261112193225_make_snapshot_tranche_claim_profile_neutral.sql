-- Accepted orders are paid against the immutable route destination snapshot.
-- The legacy tailor-profile verification flag predates provider-neutral
-- destinations and must remain authoritative only for legacy orders.
do $migration$
declare
  v_signature constant text :=
    'public.reserve_settlement_tranche_payout_row(uuid,text,uuid,text,text,text,text)';
  v_definition text;
  v_old constant text := $old$
  if not found or v_profile.user_id is distinct from v_plan.tailor_id::text
    or v_profile.payout_account_verified is distinct from true
    or v_profile.payout_reverification_required is true then
    raise exception 'Tranche payout profile is not verified for the tailor';
  end if;$old$;
  v_new constant text := $new$
  if not found or v_profile.user_id is distinct from v_plan.tailor_id::text
    or (
      v_order.accepted_route_snapshot_at is null
      and (
        v_profile.payout_account_verified is distinct from true
        or v_profile.payout_reverification_required is true
      )
    ) then
    raise exception 'Tranche payout profile is not verified for the tailor';
  end if;$new$;
begin
  v_definition := pg_get_functiondef(v_signature::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'reserve_settlement_tranche_payout_row profile guard does not match expected definition';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

comment on function public.reserve_settlement_tranche_payout_row(uuid,text,uuid,text,text,text,text)
  is 'Reserves one staged tranche payout. Accepted-route orders trust their fresh immutable payout destination; legacy orders additionally require the legacy profile verification flag.';
