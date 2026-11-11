drop function if exists public.reconcile_definite_payout_rejection(uuid,uuid,jsonb);

do $$
begin
  if exists (
    select 1 from public.payouts
    where fabric_candidate_id is not null
    group by fabric_candidate_id having count(*) > 1
  ) then
    raise exception 'Cannot restore one-payout-per-fabric-candidate while retry payout rows exist';
  end if;
end;
$$;

drop index if exists public.payouts_fabric_candidate_idx;
create unique index payouts_fabric_candidate_idx
  on public.payouts(fabric_candidate_id)
  where fabric_candidate_id is not null;
