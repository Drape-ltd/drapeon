-- A mismatched provider transfer must not remain a routine UNKNOWN tip payout.
alter table public.tip_money_operation_claims
  drop constraint tip_money_operation_claims_status_check;
alter table public.tip_money_operation_claims
  add constraint tip_money_operation_claims_status_check check (status in (
    'RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED',
    'FAILED_RECONCILED','BLOCKED_IDENTITY'
  ));

create function public.prevent_unreviewed_blocked_tip_claim_transition()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if old.status='BLOCKED_IDENTITY' and new.status<>'BLOCKED_IDENTITY' then
    raise exception 'Blocked tip payout needs reviewed reconciliation';
  end if;
  return new;
end;
$$;
create trigger tip_money_blocked_identity_guard
  before update of status on public.tip_money_operation_claims
  for each row execute function public.prevent_unreviewed_blocked_tip_claim_transition();
revoke execute on function public.prevent_unreviewed_blocked_tip_claim_transition()
  from public,anon,authenticated;

create function public.block_tip_payout_identity_conflict(
  p_claim_id uuid, p_provider text, p_evidence jsonb
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_claim public.tip_money_operation_claims%rowtype;
  v_order_id text;
begin
  if nullif(btrim(p_provider),'') is null
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or p_evidence->>'identity_conflict' is distinct from 'true' then
    raise exception 'Tip payout conflict requires provider identity evidence';
  end if;
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id for update;
  if v_claim.id is null or v_claim.operation_kind<>'PAYOUT' then
    raise exception 'Tip payout claim not found';
  end if;
  if v_claim.provider is not null and v_claim.provider::text<>p_provider then
    raise exception 'Tip payout provider cannot change';
  end if;
  if v_claim.status in ('SUCCEEDED','FAILED_RECONCILED') then
    raise exception 'Terminal tip payout needs a separate late-conflict review';
  end if;
  update public.tip_money_operation_claims set
    status='BLOCKED_IDENTITY',provider=p_provider::payment_provider,
    provider_response=p_evidence,provider_checked_at=now(),updated_at=now()
    where id=v_claim.id;
  select order_id into v_order_id from public.order_tips where id=v_claim.tip_id;
  insert into public.ops_issues (
    issue_type,severity,status,source,order_id,related_entity_type,related_entity_id,
    provider,title,description,recommended_action,dedupe_key,metadata
  ) values (
    'PAYOUT_BLOCKED','CRITICAL','OPEN','tip-payout-claim',v_order_id,
    'ORDER_TIP',v_claim.tip_id::text,p_provider,
    'Tip transfer conflicts with the payout claim',
    'Provider transfer evidence does not match this tip payout claim.',
    'Reconcile the provider transfer and locked tip amount, currency and destination before any retry.',
    'tip-payout-identity-conflict:'||v_claim.tip_id::text,
    jsonb_build_object('claim_id',v_claim.id,'tip_id',v_claim.tip_id)
  ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
  return jsonb_build_object('outcome','BLOCKED_IDENTITY','claim_id',v_claim.id);
end;
$$;
revoke execute on function public.block_tip_payout_identity_conflict(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.block_tip_payout_identity_conflict(uuid,text,jsonb)
  to service_role;
