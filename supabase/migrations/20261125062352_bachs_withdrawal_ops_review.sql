-- Complete only a reviewed Bachs bank change. Never run the legacy payout-change
-- finalizer here: it rewrites the tailor profile and resets payout readiness.
create or replace function public.ops_finalize_bachs_withdrawal_change(
  p_request_id uuid,
  p_money_desk_request_id uuid,
  p_reason text,
  p_reviewed_by text,
  p_reviewed_role text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_money public.money_desk_requests%rowtype;
  v_request public.payout_change_requests%rowtype;
  v_child public.bachs_withdrawal_destinations%rowtype;
  v_issue public.ops_issues%rowtype;
  v_principal_id uuid;
  v_previous_status text;
  v_resulting_version bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_request_id is null or p_money_desk_request_id is null or
     nullif(btrim(p_reason),'') is null or nullif(btrim(p_reviewed_by),'') is null then
    raise exception 'BACHS_WITHDRAWAL_OPS_INPUT_INVALID' using errcode = '22023';
  end if;
  select * into v_money from public.money_desk_requests
    where id=p_money_desk_request_id for update;
  if not found or v_money.action_type <> 'PAYOUT_DESTINATION_CHANGE' or
     v_money.target_type <> 'PAYOUT_CHANGE_REQUEST' or
     v_money.target_id <> p_request_id::text or
     v_money.status <> 'EXECUTING' or
     v_money.approval_count < v_money.required_approval_count then
    raise exception 'BACHS_WITHDRAWAL_OPS_APPROVAL_MISSING' using errcode = '42501';
  end if;
  select id into v_principal_id from public.ops_workforce_principals
    where email=lower(btrim(p_reviewed_by)) and status='ACTIVE'
      and 'admin'=any(roles) limit 1;
  if v_principal_id is null then
    raise exception 'BACHS_WITHDRAWAL_OPS_PRINCIPAL_INVALID' using errcode = '42501';
  end if;
  select * into v_request from public.payout_change_requests
    where id=p_request_id for update;
  if not found or v_request.status <> 'PENDING' or
     v_request.metadata->>'lifecycle_state' is distinct from 'OPS_REVIEW' or
     v_request.metadata->>'confirmation_status' is distinct from 'CONFIRMED' or
     v_request.requested_destination->>'payout_provider' is distinct from 'BACHS' then
    raise exception 'BACHS_WITHDRAWAL_OPS_REQUEST_INVALID' using errcode = '23514';
  end if;
  select * into v_child from public.bachs_withdrawal_destinations
    where payout_change_request_id=p_request_id and status='CURRENT' for update;
  if not found or v_child.ops_review_status <> 'PENDING' or
     v_child.provider_default_status <> 'SYNCED' then
    raise exception 'BACHS_WITHDRAWAL_OPS_BANK_NOT_READY' using errcode = '23514';
  end if;
  select * into v_issue from public.ops_issues
    where issue_type='PAYOUT_BLOCKED' and
      related_entity_type='payout_change_request' and
      related_entity_id=p_request_id::text
    order by created_at desc limit 1 for update;
  if not found or v_issue.canonical_status in ('RESOLVED','CLOSED') then
    raise exception 'BACHS_WITHDRAWAL_OPS_CASE_MISSING' using errcode = 'P0002';
  end if;
  update public.bachs_withdrawal_destinations
    set ops_review_status='CLEARED',ops_reviewed_at=v_now,
        ops_review_actor=lower(btrim(p_reviewed_by))
    where id=v_child.id;
  update public.payout_change_requests
    set status='APPROVED',reviewed_at=v_now,
        reviewed_by=lower(btrim(p_reviewed_by)),updated_at=v_now,
        metadata=metadata || pg_catalog.jsonb_build_object(
          'lifecycle_state','ACTIVATED','ops_reviewed_at',v_now,
          'money_desk_request_id',p_money_desk_request_id)
    where id=p_request_id;
  v_previous_status := v_issue.canonical_status;
  update public.ops_issues
    set status='RESOLVED',canonical_status='RESOLVED',
        assigned_to=lower(btrim(p_reviewed_by)),
        assigned_principal_id=v_principal_id,resolved_at=v_now,
        recommended_action='Bachs withdrawal bank change approved after Money Desk review.'
    where id=v_issue.id returning record_version into v_resulting_version;
  insert into public.ops_case_events(
    issue_id,event_type,visibility,sensitivity,actor_principal_id,
    actor_label,from_status,to_status,summary,payload,idempotency_key,
    correlation_id,occurred_at
  ) values (
    v_issue.id,'STATE_TRANSITION','INTERNAL',v_issue.sensitivity,v_principal_id,
    lower(btrim(p_reviewed_by)),v_previous_status,'RESOLVED',
    'Bachs withdrawal bank approved after Money Desk review.',
    pg_catalog.jsonb_build_object('payoutChangeRequestId',p_request_id,
      'childId',v_child.id,'moneyDeskRequestId',p_money_desk_request_id),
    'bachs-bank-change-finalized:' || p_money_desk_request_id::text,
    v_money.correlation_id,v_now
  ) on conflict (issue_id,idempotency_key) do nothing;
  insert into public.ops_action_receipts(
    issue_id,action_key,idempotency_key,actor_principal_id,
    expected_record_version,resulting_record_version,outcome,human_status,
    correlation_id,side_effects,blockers,next_action,completed_at
  ) values (
    v_issue.id,'PAYOUT_DESTINATION_CHANGE',
    'bachs-bank-change-finalized:' || p_money_desk_request_id::text,
    v_principal_id,v_issue.record_version,v_resulting_version,'SUCCEEDED',
    'The reviewed Bachs withdrawal bank is active. The connected account and order releases are unchanged.',
    v_money.correlation_id,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'type','BACHS_WITHDRAWAL_DESTINATION','status','CURRENT','opsReview','CLEARED')),
    '[]'::jsonb,'No further Ops action is required.',v_now
  ) on conflict (issue_id,idempotency_key) do nothing;
  insert into public.ops_audit_logs(
    issue_id,action_taken,performed_by,performed_role,reason,
    before_state,after_state,created_at
  ) values (
    v_issue.id,'BACHS_WITHDRAWAL_BANK_APPROVED_AFTER_REVIEW',
    lower(btrim(p_reviewed_by)),upper(btrim(p_reviewed_role)),p_reason,
    pg_catalog.jsonb_build_object('caseStatus',v_previous_status,'childId',v_child.id),
    pg_catalog.jsonb_build_object('caseStatus','RESOLVED','childId',v_child.id),v_now
  );
  return pg_catalog.jsonb_build_object('requestId',p_request_id,
    'childId',v_child.id,'moneyDeskRequestId',p_money_desk_request_id,
    'issueId',v_issue.id,'caseStatus','RESOLVED',
    'recordVersion',v_resulting_version,'correlationId',v_money.correlation_id);
end $$;
revoke all on function public.ops_finalize_bachs_withdrawal_change(
  uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.ops_finalize_bachs_withdrawal_change(
  uuid,uuid,text,text,text) to service_role;
