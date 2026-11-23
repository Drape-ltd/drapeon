-- Emergency rollback of the anomaly extension only. First revert the Edge
-- caller or pause affected payout workers. Never restore the narrower guard
-- while a confirmed claim lacks its matching success receipt.
do $$
begin
  if exists (
    select 1 from public.payout_claims c
    where c.status in ('TRANSFERRED','WITHDRAWN')
      and nullif(btrim(c.provider_transfer_id),'') is not null
      and not exists (select 1 from public.payout_attempts a
        where a.claim_id=c.id and a.status='SUCCEEDED'
          and a.provider_operation_id=c.provider_transfer_id)
  ) or exists (
    select 1 from public.ops_issues i
    where i.source='claimed-payout-execution'
      and i.metadata->>'successful_attempt_matches_transfer'='false'
      and i.status='OPEN'
  ) then
    raise exception 'Unsafe rollback: anomalous confirmed payouts need Money Desk reconciliation';
  end if;
end $$;

create or replace function public.block_confirmed_payout_identity_conflict(
  p_claim_id uuid, p_evidence jsonb
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_case_id uuid;
  v_dedupe_key text;
  v_environment text;
  v_prior_status text;
begin
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or p_evidence->>'identity_conflict' is distinct from 'true' then
    raise exception 'Confirmed payout conflict requires explicit identity evidence';
  end if;
  select * into v_claim from public.payout_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'Payout claim not found'; end if;
  v_dedupe_key := 'payout-late-provider-conflict:'||v_claim.id::text;
  select id into v_case_id from public.ops_issues
    where dedupe_key=v_dedupe_key for update;
  if v_claim.status='BLOCKED' then
    if v_case_id is null then
      raise exception 'Blocked payout claim has no confirmed-conflict case';
    end if;
    return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,
      'issue_id',v_case_id);
  end if;
  if v_claim.status not in ('TRANSFERRED','WITHDRAWN')
    or nullif(btrim(v_claim.provider_transfer_id),'') is null
    or not exists (select 1 from public.payout_attempts a
      where a.claim_id=v_claim.id and a.status='SUCCEEDED'
        and a.provider_operation_id=v_claim.provider_transfer_id) then
    raise exception 'Only a provider-confirmed payout can enter late identity review';
  end if;

  v_prior_status := v_claim.status;
  v_environment := public.current_ops_environment();
  if v_environment not in ('DEVELOPMENT','PRODUCTION') then
    raise exception 'Ops environment is not configured for confirmed payout review';
  end if;
  update public.payout_claims set status='BLOCKED',transfer_status='UNKNOWN',
    last_provider_checked_at=now() where id=v_claim.id;

  if v_case_id is null then
    insert into public.ops_issues (
      issue_type,severity,status,canonical_status,source,order_id,
      related_entity_type,related_entity_id,provider,title,description,
      recommended_action,dedupe_key,metadata,queue_key,owning_team,
      priority,sensitivity,environment,provenance
    ) values (
      'PAYOUT_FAILED','CRITICAL','OPEN','NEW','claimed-payout-execution',
      v_claim.order_id,'PAYOUT_CLAIM',v_claim.id::text,v_claim.provider,
      'Confirmed payout changed before ledger completion',
      'Provider transfer evidence changed after confirmation; local payout completion was held.',
      'Reconcile the exact provider transfer and bank-withdrawal state before completing or replacing this earning.',
      v_dedupe_key,
      jsonb_build_object('claim_id',v_claim.id,
        'provider_transfer_id',v_claim.provider_transfer_id,
        'prior_claim_status',v_prior_status),
      'money-desk','finance','P0','SENSITIVE',v_environment,
      case when v_environment='DEVELOPMENT' then 'QA' else 'REAL' end
    ) returning id into v_case_id;
    insert into public.ops_audit_logs (
      issue_id,action_taken,performed_role,reason,before_state,after_state
    ) values (
      v_case_id,'ISSUE_CREATED','SYSTEM',
      'Confirmed payout identity recheck contradicted the frozen transfer',null,
      jsonb_build_object('status','OPEN','canonical_status','NEW',
        'claim_id',v_claim.id,'prior_claim_status',v_prior_status,
        'claim_status','BLOCKED')
    );
  else
    update public.ops_issues set status='OPEN',canonical_status='NEW',
      queue_key='money-desk',owning_team='finance',priority='P0',
      environment=v_environment,
      provenance=case when v_environment='DEVELOPMENT' then 'QA' else 'REAL' end,
      last_seen_at=now(),resolved_at=null where id=v_case_id;
    insert into public.ops_audit_logs (
      issue_id,action_taken,performed_role,reason,before_state,after_state
    ) values (
      v_case_id,'ISSUE_REOPENED','SYSTEM',
      'Confirmed payout claim was durably blocked after provider identity conflict',
      jsonb_build_object('claim_status',v_prior_status),
      jsonb_build_object('claim_status','BLOCKED','canonical_status','NEW')
    );
  end if;
  return jsonb_build_object('outcome','BLOCKED','claim_id',v_claim.id,
    'issue_id',v_case_id);
end;
$$;

revoke execute on function public.block_confirmed_payout_identity_conflict(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.block_confirmed_payout_identity_conflict(uuid,jsonb)
  to service_role;
