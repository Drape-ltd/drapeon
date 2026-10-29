-- Claim status is independent of payment status: a provider response is recorded
-- first; the payment and commercial ledger still require their own finalizer.
create function public.guard_order_payment_refund_claim_status()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'RESERVED' or new.provider_refund_id is not null then
      raise exception 'New refund claim must start reserved';
    end if;
    return new;
  end if;
  if (old.status='SUCCEEDED' and new.status <> 'SUCCEEDED')
    or (old.status='FAILED_RECONCILED'
      and new.status not in ('FAILED_RECONCILED','SUCCEEDED'))
    or (old.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING')
      and new.status='RESERVED')
    or (new.status='SUCCEEDED' and nullif(btrim(new.provider_refund_id),'') is null) then
    raise exception 'Refund claim status transition is unsafe';
  end if;
  return new;
end;
$$;
create trigger order_payment_refund_claim_status_guard
  before insert or update on public.order_payment_refund_claims
  for each row execute function public.guard_order_payment_refund_claim_status();
revoke all on function public.guard_order_payment_refund_claim_status()
  from public, anon, authenticated;

create function public.record_order_payment_refund_claim_outcome(
  p_claim_id uuid,
  p_provider public.payment_provider,
  p_next_status text,
  p_provider_refund_id text,
  p_provider_evidence jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_claim public.order_payment_refund_claims%rowtype;
  v_outcome text := 'RECORDED';
begin
  if p_claim_id is null or p_provider is null or p_next_status is null
    or p_next_status not in (
      'PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED')
    or p_provider_evidence is null
    or jsonb_typeof(p_provider_evidence) <> 'object'
    or pg_column_size(p_provider_evidence) > 32768
    or (p_next_status='SUCCEEDED'
      and nullif(btrim(p_provider_refund_id),'') is null) then
    return jsonb_build_object('outcome','INVALID_REQUEST');
  end if;

  select * into v_claim from public.order_payment_refund_claims
    where id=p_claim_id for update;
  if not found then return jsonb_build_object('outcome','NOT_FOUND'); end if;
  if v_claim.provider <> p_provider
    or (v_claim.provider_refund_id is not null
      and nullif(btrim(p_provider_refund_id),'') is not null
      and v_claim.provider_refund_id <> nullif(btrim(p_provider_refund_id),'')) then
    return jsonb_build_object('outcome','IDENTITY_CONFLICT');
  end if;
  if (v_claim.status='SUCCEEDED' and p_next_status<>'SUCCEEDED')
    or (v_claim.status='FAILED_RECONCILED'
      and p_next_status not in ('FAILED_RECONCILED','SUCCEEDED')) then
    return jsonb_build_object('outcome','TERMINAL_CONFLICT');
  end if;
  if v_claim.status=p_next_status
    and (nullif(btrim(p_provider_refund_id),'') is null
      or v_claim.provider_refund_id=nullif(btrim(p_provider_refund_id),'')) then
    return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,
      'status',v_claim.status,'provider_refund_id',v_claim.provider_refund_id);
  end if;
  if v_claim.status='FAILED_RECONCILED' and p_next_status='SUCCEEDED' then
    v_outcome := 'LATE_SUCCESS';
  end if;

  update public.order_payment_refund_claims set
    status=p_next_status,
    provider_refund_id=coalesce(provider_refund_id,nullif(btrim(p_provider_refund_id),'')),
    provider_evidence=p_provider_evidence,
    updated_at=now()
  where id=p_claim_id
  returning * into v_claim;
  return jsonb_build_object('outcome',v_outcome,'claim_id',v_claim.id,
    'status',v_claim.status,'provider_refund_id',v_claim.provider_refund_id);
end;
$$;
revoke all on function public.record_order_payment_refund_claim_outcome(
  uuid,public.payment_provider,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_order_payment_refund_claim_outcome(
  uuid,public.payment_provider,text,text,jsonb)
  to service_role;
