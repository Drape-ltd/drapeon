-- Provider calls happen after reservation commits. Only provider evidence may
-- advance a claim; time elapsed is never proof that money did not move.
alter table public.tip_money_operation_claims
  add constraint tip_money_operation_terminal_evidence check (
    status not in ('SUCCEEDED', 'FAILED_RECONCILED')
    or (provider_checked_at is not null and provider_response <> '{}'::jsonb)
  );

create unique index tip_money_operation_provider_reference_idx
  on public.tip_money_operation_claims(provider, provider_operation_id)
  where provider is not null and provider_operation_id is not null;

create function public.record_tip_money_operation_outcome(
  p_claim_id uuid,
  p_next_status text,
  p_provider text,
  p_provider_operation_id text,
  p_provider_response jsonb
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_claim public.tip_money_operation_claims%rowtype;
begin
  if p_next_status not in ('PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED')
    or nullif(btrim(p_provider), '') is null
    or p_provider_response is null or jsonb_typeof(p_provider_response) <> 'object'
    or p_provider_response = '{}'::jsonb then
    raise exception 'Tip operation outcome needs a provider and nonempty evidence';
  end if;
  if p_next_status = 'SUCCEEDED' and nullif(btrim(p_provider_operation_id), '') is null then
    raise exception 'A completed tip operation needs a provider reference';
  end if;
  select * into v_claim from public.tip_money_operation_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'Tip operation claim not found'; end if;
  if v_claim.provider is not null and v_claim.provider <> p_provider then
    raise exception 'Tip operation provider cannot change';
  end if;
  if v_claim.provider_operation_id is not null
    and v_claim.provider_operation_id is distinct from p_provider_operation_id then
    raise exception 'Tip operation provider reference cannot change';
  end if;
  if v_claim.status in ('SUCCEEDED', 'FAILED_RECONCILED') then
    if v_claim.status <> p_next_status then raise exception 'Terminal tip operation cannot be overwritten'; end if;
    return jsonb_build_object('outcome', 'EXISTING', 'status', v_claim.status, 'claim_id', v_claim.id);
  end if;
  if v_claim.status = 'PROVIDER_PENDING' and p_next_status = 'PROVIDER_UNKNOWN' then
    raise exception 'Tip operation cannot regress from provider pending to unknown';
  end if;
  update public.tip_money_operation_claims set
    status = p_next_status,
    provider = p_provider,
    provider_operation_id = coalesce(provider_operation_id, nullif(btrim(p_provider_operation_id), '')),
    provider_response = p_provider_response,
    provider_checked_at = now(),
    terminal_at = case when p_next_status in ('SUCCEEDED', 'FAILED_RECONCILED') then now() else null end,
    updated_at = now()
  where id = p_claim_id;
  return jsonb_build_object('outcome', 'RECORDED', 'status', p_next_status, 'claim_id', p_claim_id);
end;
$$;

revoke execute on function public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)
  to service_role;
