-- Short transaction only: commit the business claim before contacting a provider.
create function public.reserve_payout_claim(
  p_business_key text,
  p_source_kind text,
  p_source_id text,
  p_order_id text,
  p_tailor_profile_id text,
  p_provider text,
  p_provider_destination_id text,
  p_currency public.currency,
  p_amount integer,
  p_route_version text,
  p_earning_policy_version text,
  p_tailor_terms_version text,
  p_provider_idempotency_key text
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_inserted uuid;
  v_claim public.payout_claims%rowtype;
begin
  if nullif(btrim(p_business_key),'') is null
    or nullif(btrim(p_source_id),'') is null
    or nullif(btrim(p_provider_idempotency_key),'') is null then
    raise exception 'Payout claim needs stable business and provider keys';
  end if;
  insert into public.payout_claims (
    business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
    provider_destination_id,currency,amount,route_version,earning_policy_version,
    tailor_terms_version,provider_idempotency_key
  ) values (
    p_business_key,p_source_kind,p_source_id,p_order_id,p_tailor_profile_id,p_provider,
    p_provider_destination_id,p_currency,p_amount,p_route_version,p_earning_policy_version,
    p_tailor_terms_version,p_provider_idempotency_key
  ) on conflict do nothing returning id into v_inserted;

  select * into v_claim from public.payout_claims
    where business_key=p_business_key for update;
  if v_claim.id is null then
    raise exception 'Payout claim key conflicts with an unrelated earning or provider key';
  end if;
  if row(v_claim.source_kind,v_claim.source_id,v_claim.order_id,v_claim.tailor_profile_id,
         v_claim.provider,v_claim.provider_destination_id,v_claim.currency,v_claim.amount,
         v_claim.route_version,v_claim.earning_policy_version,v_claim.tailor_terms_version,
         v_claim.provider_idempotency_key)
     is distinct from
     row(p_source_kind,p_source_id,p_order_id,p_tailor_profile_id,
         p_provider,p_provider_destination_id,p_currency,p_amount,
         p_route_version,p_earning_policy_version,p_tailor_terms_version,
         p_provider_idempotency_key) then
    raise exception 'Payout claim identity conflicts with accepted earning';
  end if;
  return jsonb_build_object(
    'outcome', case when v_inserted is null then 'EXISTING' else 'RESERVED' end,
    'claim_id',v_claim.id,'status',v_claim.status,
    'provider_idempotency_key',v_claim.provider_idempotency_key,
    'provider_transfer_id',v_claim.provider_transfer_id,
    'payout_id',v_claim.payout_id
  );
end;
$$;

revoke execute on function public.reserve_payout_claim(
  text,text,text,text,text,text,text,public.currency,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.reserve_payout_claim(
  text,text,text,text,text,text,text,public.currency,integer,text,text,text,text
) to service_role;
