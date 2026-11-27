-- Dev proof only: require two distinct Money Desk decisions for a Bachs
-- payout-bank change. The current pending request was prepared under the
-- one-founder prelaunch policy, before this target type was covered.
do $$
begin
  if public.current_ops_environment() <> 'DEVELOPMENT'
    or not public.is_dev_ops_mfa_environment() then
    raise exception 'DEV_PAYOUT_CHANGE_DUAL_APPROVAL_ONLY';
  end if;
end $$;

alter table public.money_desk_events
  drop constraint money_desk_events_event_type_check;
alter table public.money_desk_events
  add constraint money_desk_events_event_type_check check (event_type in (
    'REQUEST_SUBMITTED','APPROVAL_RECORDED','REQUEST_APPROVED',
    'REQUEST_REJECTED','EXECUTION_STARTED','EXECUTION_SUCCEEDED',
    'EXECUTION_FAILED','EXECUTION_BLOCKED','REQUEST_CANCELLED',
    'FOUNDER_APPROVAL_EMAIL_SENT','FOUNDER_APPROVAL_EMAIL_SKIPPED',
    'FOUNDER_APPROVAL_EMAIL_FAILED','APPROVAL_POLICY_STRENGTHENED'
  ));

create or replace function public.apply_founder_money_desk_approval_policy()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.action_type='PAYOUT_DESTINATION_CHANGE'
    and new.target_type in ('ORDER_PAYOUT_FAILURE','PAYOUT_CHANGE_REQUEST') then
    new.required_approval_count := 2;
    new.risk_reasons := array_remove(new.risk_reasons,'FOUNDER_APPROVAL_REQUIRED');
    if not ('ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL'=any(new.risk_reasons)) then
      new.risk_reasons := array_append(new.risk_reasons,'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL');
    end if;
    new.policy_version := 'commercial-prelaunch-dual-payout-recovery-v2';
  else
    new.required_approval_count := 1;
    new.risk_reasons := array_replace(new.risk_reasons,
      'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL','FOUNDER_APPROVAL_REQUIRED');
    new.policy_version := 'commercial-prelaunch-founder-v1';
  end if;
  return new;
end $$;

create or replace function public.protect_money_desk_request_claim()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.action_type is distinct from old.action_type
    or new.target_type is distinct from old.target_type
    or new.target_id is distinct from old.target_id
    or new.order_id is distinct from old.order_id
    or new.case_id is distinct from old.case_id
    or new.amount is distinct from old.amount
    or new.currency is distinct from old.currency
    or new.amount_usd_equivalent is distinct from old.amount_usd_equivalent
    or new.usd_equivalent_source is distinct from old.usd_equivalent_source
    or new.reason is distinct from old.reason
    or new.action_payload is distinct from old.action_payload
    or new.requester_email is distinct from old.requester_email
    or new.requester_subject is distinct from old.requester_subject
    or new.requester_role is distinct from old.requester_role
    or new.requester_jit_grant_id is distinct from old.requester_jit_grant_id
    or new.risk_level is distinct from old.risk_level
    or new.correlation_id is distinct from old.correlation_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Money Desk request claims are immutable.';
  end if;
  if new.risk_reasons is distinct from old.risk_reasons
    or new.required_approval_count is distinct from old.required_approval_count
    or new.policy_version is distinct from old.policy_version then
    if not (public.current_ops_environment()='DEVELOPMENT'
      and public.is_dev_ops_mfa_environment()
      and old.action_type='PAYOUT_DESTINATION_CHANGE'
      and old.target_type='PAYOUT_CHANGE_REQUEST'
      and old.status='PENDING_APPROVAL'
      and old.approval_count=0
      and old.required_approval_count=1
      and new.required_approval_count=2
      and old.policy_version='commercial-prelaunch-founder-v1'
      and new.policy_version='commercial-prelaunch-dual-payout-recovery-v2'
      and new.risk_reasons=array_append(
        array_remove(old.risk_reasons,'FOUNDER_APPROVAL_REQUIRED'),
        'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL')) then
      raise exception 'Money Desk request claims are immutable.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

do $$
declare v_request public.money_desk_requests%rowtype; v_decisions integer;
begin
  select * into v_request from public.money_desk_requests
    where id='ed3dd915-a49c-4362-928d-867d7728c2c2' for update;
  select count(*) into v_decisions from public.money_desk_decisions
    where request_id=v_request.id;
  if v_request.id is null or v_request.action_type<>'PAYOUT_DESTINATION_CHANGE'
    or v_request.target_type<>'PAYOUT_CHANGE_REQUEST'
    or v_request.status<>'PENDING_APPROVAL'
    or v_request.approval_count<>0 or v_request.required_approval_count<>1
    or v_decisions<>0 then
    raise exception 'DEV_PAYOUT_CHANGE_REQUEST_STATE_CHANGED';
  end if;
  update public.money_desk_requests
  set required_approval_count=2,
      policy_version='commercial-prelaunch-dual-payout-recovery-v2',
      risk_reasons=array_append(
        array_remove(risk_reasons,'FOUNDER_APPROVAL_REQUIRED'),
        'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL')
  where id=v_request.id;
  insert into public.money_desk_events
    (request_id,event_type,actor_email,actor_role,payload,correlation_id)
  values (v_request.id,'APPROVAL_POLICY_STRENGTHENED',
    'phase4-dev-migration@drapeon.invalid','SYSTEM',
    jsonb_build_object('from',v_request.policy_version,
      'to','commercial-prelaunch-dual-payout-recovery-v2',
      'oldRequired',1,'newRequired',2),v_request.correlation_id);
end $$;

revoke all on function public.apply_founder_money_desk_approval_policy() from public,anon,authenticated;
revoke all on function public.protect_money_desk_request_claim() from public,anon,authenticated;
