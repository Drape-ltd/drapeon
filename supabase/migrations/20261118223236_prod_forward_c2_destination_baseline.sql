-- C2 data-only destination repair. The current Dev count is zero. A later
-- Production preflight must prove zero repairable and zero conflicting rows;
-- any nonzero count requires an evidence-scoped reviewed data migration.
do $baseline$
declare
  v_candidates integer;
  v_updated integer;
begin
  with candidates as (
    select claim.payout_id, claim.provider_destination_id
      from public.payout_claims claim
      where nullif(btrim(claim.provider_destination_id),'') is not null
    union all
    select tip_claim.payout_id,
      nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'),'')
      from public.tip_money_operation_claims tip_claim
      where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'),'') is not null
  ), grouped as (
    select payout_id,count(distinct provider_destination_id) n
      from candidates group by payout_id
  )
  select count(*) into v_candidates from public.payouts p
    join grouped g on p.id::text=g.payout_id
    where p.provider_destination_id is null;
  if v_candidates <> 0 then
    raise exception 'C2_DESTINATION_REQUIRES_ROW_REVIEW:%',v_candidates;
  end if;
  with candidates as (
    select claim.payout_id, claim.provider_destination_id
    from public.payout_claims claim
    where nullif(btrim(claim.provider_destination_id), '') is not null
    union all
    select tip_claim.payout_id,
      nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '')
    from public.tip_money_operation_claims tip_claim
    where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '') is not null
  ), unambiguous as (
    select payout_id, min(provider_destination_id) as provider_destination_id
    from candidates
    group by payout_id
    having count(distinct provider_destination_id) = 1
  )
  update public.payouts payout
  set provider_destination_id = unambiguous.provider_destination_id,
      provider_response = coalesce(payout.provider_response, '{}'::jsonb)
        || jsonb_build_object('c2_destination_repaired_at', now())
  from unambiguous
  where payout.id::text = unambiguous.payout_id
    and payout.provider_destination_id is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'C2_DESTINATION_CHANGED_DURING_APPLY:%',v_updated;
  end if;
end;
$baseline$;
