-- Restore the prior request-status mapping; use only in an isolated rollback rehearsal.
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
