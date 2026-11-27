-- All child-bank writes run through these service-only, audited transitions.
create or replace function public.initialize_bachs_withdrawal_destination(
  p_payout_destination_id uuid,
  p_provider_destination_ref text,
  p_bank_name text,
  p_account_last4 text,
  p_account_name text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.payout_destinations%rowtype;
  v_existing public.bachs_withdrawal_destinations%rowtype;
  v_id uuid;
begin
  if p_payout_destination_id is null or p_provider_destination_ref is null or
     p_provider_destination_ref !~ '^pd_[A-Za-z0-9_-]{1,196}$' then
    raise exception 'BACHS_WITHDRAWAL_INITIAL_INPUT_INVALID' using errcode = '22023';
  end if;
  select * into v_parent from public.payout_destinations
    where id=p_payout_destination_id and provider='BACHS' for update;
  if not found or v_parent.provider_destination_ref is distinct from p_provider_destination_ref then
    raise exception 'BACHS_WITHDRAWAL_INITIAL_PARENT_INVALID' using errcode = '23514';
  end if;
  select * into v_existing from public.bachs_withdrawal_destinations
    where payout_destination_id=p_payout_destination_id and status='CURRENT' for update;
  if found then
    if v_existing.provider_destination_ref <> p_provider_destination_ref then
      raise exception 'BACHS_WITHDRAWAL_INITIAL_CONFLICT' using errcode = '23514';
    end if;
    return v_existing.id;
  end if;
  insert into public.bachs_withdrawal_destinations(
    payout_destination_id,provider_destination_ref,status,bank_name,
    account_last4,account_name,confirmed_at,decision_reason,
    provider_default_status,provider_default_synced_at,ops_review_status
  ) values (
    p_payout_destination_id,p_provider_destination_ref,'CURRENT',nullif(btrim(p_bank_name),''),
    nullif(btrim(p_account_last4),''),nullif(btrim(p_account_name),''),clock_timestamp(),
    'ORIGINAL_ONBOARDING','SYNCED',clock_timestamp(),'CLEARED'
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function public.stage_bachs_withdrawal_destination(
  p_payout_destination_id uuid,
  p_change_request_id uuid,
  p_provider_destination_ref text,
  p_bank_name text,
  p_account_last4 text,
  p_account_name text,
  p_actor_id uuid,
  p_observed_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.payout_destinations%rowtype;
  v_request public.payout_change_requests%rowtype;
  v_current public.bachs_withdrawal_destinations%rowtype;
  v_pending public.bachs_withdrawal_destinations%rowtype;
  v_id uuid;
begin
  if p_payout_destination_id is null or p_change_request_id is null or
     p_actor_id is null or p_observed_at is null or
     p_provider_destination_ref is null or
     p_provider_destination_ref !~ '^pd_[A-Za-z0-9_-]{1,196}$' then
    raise exception 'BACHS_WITHDRAWAL_STAGE_INPUT_INVALID' using errcode = '22023';
  end if;
  select * into v_parent from public.payout_destinations
    where id = p_payout_destination_id and provider = 'BACHS' for update;
  if not found then
    raise exception 'BACHS_WITHDRAWAL_PARENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_request from public.payout_change_requests
    where id = p_change_request_id for update;
  if not found or v_request.status <> 'PENDING' or
     v_request.tailor_user_id <> p_actor_id or
     v_request.tailor_profile_id <> v_parent.tailor_profile_id::text or
     v_request.metadata->>'change_kind' is distinct from 'BACHS_DESTINATION' or
     v_request.requested_destination->>'provider_destination_ref'
       is distinct from p_provider_destination_ref then
    raise exception 'BACHS_WITHDRAWAL_REQUEST_INVALID' using errcode = '42501';
  end if;
  select * into v_current from public.bachs_withdrawal_destinations
    where payout_destination_id = v_parent.id and status = 'CURRENT' for update;
  if not found or v_current.provider_destination_ref = p_provider_destination_ref then
    raise exception 'BACHS_WITHDRAWAL_REPLACEMENT_INVALID' using errcode = '23514';
  end if;
  select * into v_pending from public.bachs_withdrawal_destinations
    where payout_destination_id = v_parent.id and status = 'PENDING_CONFIRMATION' for update;
  if found then
    if v_pending.payout_change_request_id = p_change_request_id and
       v_pending.provider_destination_ref = p_provider_destination_ref then
      return v_pending.id;
    end if;
    raise exception 'BACHS_WITHDRAWAL_CHANGE_ALREADY_PENDING' using errcode = '23505';
  end if;
  insert into public.bachs_withdrawal_destinations (
    payout_destination_id,payout_change_request_id,provider_destination_ref,
    status,bank_name,account_last4,account_name,requested_at
  ) values (
    v_parent.id,p_change_request_id,p_provider_destination_ref,
    'PENDING_CONFIRMATION',nullif(btrim(p_bank_name),''),
    nullif(btrim(p_account_last4),''),nullif(btrim(p_account_name),''),p_observed_at
  ) returning id into v_id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload)
  values (p_actor_id,'TAILOR','payout.bachs_bank_change_staged','info',
          pg_catalog.jsonb_build_object('request_id',p_change_request_id,
            'child_id',v_id,'account_destination_id',v_parent.id));
  return v_id;
end $$;

-- A provider PATCH can fail after the local current-bank switch. Keep that
-- state visible until the exact new provider default is retrieved and matched.
create or replace function public.record_bachs_withdrawal_default_result(
  p_child_id uuid,
  p_observed_provider_destination_ref text,
  p_synced boolean,
  p_reason text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_child public.bachs_withdrawal_destinations%rowtype;
  v_result text;
begin
  if p_child_id is null or p_observed_provider_destination_ref is null or
     p_synced is null or nullif(btrim(p_reason),'') is null then
    raise exception 'BACHS_WITHDRAWAL_DEFAULT_INPUT_INVALID' using errcode = '22023';
  end if;
  select * into v_child from public.bachs_withdrawal_destinations
    where id = p_child_id for update;
  if not found or v_child.status <> 'CURRENT' then
    raise exception 'BACHS_WITHDRAWAL_CURRENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_synced and v_child.provider_destination_ref <> p_observed_provider_destination_ref then
    raise exception 'BACHS_WITHDRAWAL_DEFAULT_MISMATCH' using errcode = '23514';
  end if;
  v_result := case when p_synced then 'SYNCED' else 'FAILED' end;
  if v_child.provider_default_status = v_result then return v_result; end if;
  update public.bachs_withdrawal_destinations
    set provider_default_status=v_result,
        provider_default_synced_at=case when p_synced then clock_timestamp() else null end
    where id=p_child_id;
  insert into public.audit_logs(actor_role,event,severity,payload)
  values ('SYSTEM','payout.bachs_bank_default_result','info',
          pg_catalog.jsonb_build_object('child_id',p_child_id,'result',v_result,
            'reason',p_reason));
  return v_result;
end $$;

create or replace function public.decide_bachs_withdrawal_destination(
  p_child_id uuid,
  p_outcome text,
  p_actor_id uuid,
  p_reason text,
  p_decided_at timestamptz,
  p_requires_ops_review boolean
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_child public.bachs_withdrawal_destinations%rowtype;
  v_request public.payout_change_requests%rowtype;
  v_current public.bachs_withdrawal_destinations%rowtype;
  v_status text;
begin
  if p_child_id is null or p_outcome is null or p_outcome not in
      ('CONFIRMED','CANCELLED','EXPIRED','REJECTED') or
      p_decided_at is null or p_requires_ops_review is null or
      nullif(btrim(p_reason),'') is null then
    raise exception 'BACHS_WITHDRAWAL_DECISION_INPUT_INVALID' using errcode = '22023';
  end if;
  if abs(extract(epoch from p_decided_at - clock_timestamp())) > 60 then
    raise exception 'BACHS_WITHDRAWAL_DECISION_TIME_INVALID' using errcode = '22023';
  end if;
  select * into v_child from public.bachs_withdrawal_destinations
    where id = p_child_id for update;
  if not found then
    raise exception 'BACHS_WITHDRAWAL_CHILD_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_status := case p_outcome when 'CONFIRMED' then 'CURRENT' else p_outcome end;
  if v_child.status = v_status then return v_status; end if;
  if v_child.status <> 'PENDING_CONFIRMATION' or
     v_child.payout_change_request_id is null then
    raise exception 'BACHS_WITHDRAWAL_DECISION_CONFLICT' using errcode = '23514';
  end if;
  select * into v_request from public.payout_change_requests
    where id = v_child.payout_change_request_id for update;
  if not found or v_request.status <> 'PENDING' or
     v_request.metadata->>'change_kind' is distinct from 'BACHS_DESTINATION' then
    raise exception 'BACHS_WITHDRAWAL_REQUEST_NOT_PENDING' using errcode = '23514';
  end if;
  if p_outcome in ('CONFIRMED','CANCELLED') and
     (p_actor_id is null or p_actor_id <> v_request.tailor_user_id) then
    raise exception 'BACHS_WITHDRAWAL_ACTOR_NOT_OWNER' using errcode = '42501';
  end if;
  if p_outcome = 'CONFIRMED' and
     p_decided_at > v_child.requested_at + interval '48 hours' then
    raise exception 'BACHS_WITHDRAWAL_CONFIRMATION_EXPIRED' using errcode = '23514';
  end if;
  if p_outcome = 'CONFIRMED' then
    select * into v_current from public.bachs_withdrawal_destinations
      where payout_destination_id = v_child.payout_destination_id
        and status = 'CURRENT' for update;
    if not found or v_current.id = v_child.id then
      raise exception 'BACHS_WITHDRAWAL_CURRENT_MISSING' using errcode = '23514';
    end if;
    update public.bachs_withdrawal_destinations
      set status='RETIRED',retired_at=p_decided_at,decided_at=p_decided_at,
          decision_actor_id=p_actor_id,decision_reason=p_reason
      where id=v_current.id;
    update public.bachs_withdrawal_destinations
      set status='CURRENT',confirmed_at=p_decided_at,decided_at=p_decided_at,
          decision_actor_id=p_actor_id,decision_reason=p_reason,
          provider_default_status='PENDING',
          ops_review_status=case when p_requires_ops_review then 'PENDING' else 'CLEARED' end
      where id=v_child.id;
  else
    update public.bachs_withdrawal_destinations
      set status=v_status,decided_at=p_decided_at,
          decision_actor_id=p_actor_id,decision_reason=p_reason
      where id=v_child.id;
  end if;
  update public.payout_change_requests
    set status=case when p_outcome='CONFIRMED' and p_requires_ops_review then 'PENDING'
                    when p_outcome='CONFIRMED' then 'APPROVED'
                    when p_outcome='REJECTED' then 'REJECTED' else 'CANCELLED' end,
        reviewed_at=case when p_outcome='CONFIRMED' and p_requires_ops_review
                         then null else p_decided_at end,
        reviewed_by=case when p_outcome='CONFIRMED' and p_requires_ops_review
                         then null else p_actor_id::text end,
        metadata=metadata || pg_catalog.jsonb_build_object(
          'lifecycle_state',case when p_outcome='CONFIRMED' and p_requires_ops_review
                                 then 'OPS_REVIEW' when p_outcome='CONFIRMED'
                                 then 'ACTIVATED' else p_outcome end,
          'confirmation_status',case when p_outcome='CONFIRMED' then 'CONFIRMED' else p_outcome end,
          'decided_at',p_decided_at),
        updated_at=p_decided_at
    where id=v_request.id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload)
  values (p_actor_id,case when p_actor_id is null then 'SYSTEM' else 'TAILOR' end,
          'payout.bachs_bank_change_decided','info',
          pg_catalog.jsonb_build_object('request_id',v_request.id,
            'child_id',v_child.id,'outcome',p_outcome));
  return v_status;
end $$;

revoke all on function public.stage_bachs_withdrawal_destination(
  uuid,uuid,text,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.stage_bachs_withdrawal_destination(
  uuid,uuid,text,text,text,text,uuid,timestamptz) to service_role;
revoke all on function public.initialize_bachs_withdrawal_destination(
  uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.initialize_bachs_withdrawal_destination(
  uuid,text,text,text,text) to service_role;
revoke all on function public.decide_bachs_withdrawal_destination(
  uuid,text,uuid,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.decide_bachs_withdrawal_destination(
  uuid,text,uuid,text,timestamptz,boolean) to service_role;
revoke all on function public.record_bachs_withdrawal_default_result(
  uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.record_bachs_withdrawal_default_result(
  uuid,text,boolean,text) to service_role;
