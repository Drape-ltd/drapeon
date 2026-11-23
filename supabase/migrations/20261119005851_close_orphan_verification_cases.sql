-- Close a verification investigation only when its account, profile, and
-- source handoff are all absent. This does not make a trust decision.
create or replace function public.close_orphan_verification_case(
  p_issue_id uuid, p_reason text, p_expected_record_version bigint,
  p_idempotency_key text, p_actor_principal_id uuid, p_actor_label text,
  p_environment text, p_sensitive_assurance boolean, p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_issue public.ops_issues%rowtype;
  v_principal public.ops_workforce_principals%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_user_id uuid;
  v_handoff_id uuid;
  v_old_status text;
  v_now timestamptz := now();
begin
  if p_issue_id is null or p_actor_principal_id is null or p_correlation_id is null
    or p_expected_record_version is null
    or length(trim(coalesce(p_reason,''))) not between 20 and 1000
    or length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180
    or length(trim(coalesce(p_actor_label,''))) not between 3 and 180 then
    raise exception 'Case, actor, version, and detailed reason required.' using errcode='22023';
  end if;
  if p_sensitive_assurance is distinct from true
    or public.current_ops_environment() <> upper(trim(coalesce(p_environment,''))) then
    raise exception 'Fresh protected access in this environment required.' using errcode='42501';
  end if;
  select * into v_principal from public.ops_workforce_principals
    where id=p_actor_principal_id for share;
  if v_principal.id is null or v_principal.status <> 'ACTIVE'
    or not ('admin'=any(v_principal.roles))
    or not (lower(p_environment)=any(v_principal.permitted_environments)) then
    raise exception 'Admin workforce principal required.' using errcode='42501';
  end if;
  select * into v_issue from public.ops_issues where id=p_issue_id for update;
  if v_issue.id is null or v_issue.issue_type <> 'TAILOR_VERIFICATION'
    or v_issue.environment <> upper(p_environment) or v_issue.provenance='UNKNOWN' then
    raise exception 'Verification case in this environment required.' using errcode='42501';
  end if;
  select * into v_receipt from public.ops_action_receipts
    where issue_id=p_issue_id and idempotency_key=trim(p_idempotency_key);
  if v_receipt.id is not null then
    return jsonb_build_object('duplicate',true,'receiptId',v_receipt.id,
      'receiptOutcome',v_receipt.outcome,'recordVersion',v_receipt.resulting_record_version);
  end if;
  if v_issue.canonical_status in ('RESOLVED','CLOSED','CANCELLED') then
    raise exception 'Verification case is terminal.' using errcode='55000';
  end if;
  if v_issue.record_version <> p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%',v_issue.record_version using errcode='40001';
  end if;
  if v_issue.user_id is null or v_issue.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Case has no verifiable account reference.' using errcode='55000';
  end if;
  v_user_id := v_issue.user_id::uuid;
  if exists(select 1 from auth.users where id=v_user_id)
    or exists(select 1 from public.users where id=v_user_id)
    or exists(select 1 from public.tailor_profiles where user_id::text=v_user_id::text) then
    raise exception 'Account or profile still exists; use normal trust review.' using errcode='55000';
  end if;
  if v_issue.related_entity_id is not null
    and v_issue.related_entity_type is distinct from 'identity_verification_handoff' then
    raise exception 'Case has an unexpected source record.' using errcode='55000';
  end if;
  if v_issue.related_entity_type='identity_verification_handoff' and v_issue.related_entity_id is not null then
    if v_issue.related_entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Case source cannot be verified.' using errcode='55000';
    end if;
    v_handoff_id := v_issue.related_entity_id::uuid;
  elsif v_issue.metadata ? 'handoff_id' then
    if (v_issue.metadata->>'handoff_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Case source cannot be verified.' using errcode='55000';
    end if;
    v_handoff_id := (v_issue.metadata->>'handoff_id')::uuid;
  end if;
  if v_handoff_id is not null and exists(select 1 from public.identity_verification_handoffs where id=v_handoff_id) then
    raise exception 'Verification handoff still exists; use normal trust review.' using errcode='55000';
  end if;
  v_old_status := v_issue.canonical_status;
  update public.ops_issues set canonical_status='RESOLVED',status='RESOLVED',resolved_at=v_now,
    metadata=metadata || jsonb_build_object('closureType','ORPHANED_SOURCE','closedAt',v_now)
    where id=p_issue_id;
  select * into v_issue from public.ops_issues where id=p_issue_id;
  insert into public.ops_action_receipts(issue_id,action_key,idempotency_key,actor_principal_id,
    expected_record_version,resulting_record_version,outcome,human_status,correlation_id,
    side_effects,blockers,completed_at)
  values(p_issue_id,'CLOSE_ORPHAN_VERIFICATION',trim(p_idempotency_key),p_actor_principal_id,
    p_expected_record_version,v_issue.record_version,'SUCCEEDED',
    'Orphaned verification case resolved without a seller decision.',p_correlation_id,
    jsonb_build_array(jsonb_build_object('type','OPS_CASE_CLOSURE','id',p_issue_id)),
    '[]'::jsonb,v_now) returning * into v_receipt;
  insert into public.ops_case_events(issue_id,event_type,visibility,sensitivity,
    actor_principal_id,actor_label,from_status,to_status,summary,payload,idempotency_key,correlation_id)
  values(p_issue_id,'STATE_TRANSITION','INTERNAL','SENSITIVE',p_actor_principal_id,trim(p_actor_label),
    v_old_status,'RESOLVED','Orphaned verification case resolved; no trust decision made.',
    jsonb_build_object('reason',trim(p_reason),'userId',v_user_id,'handoffId',v_handoff_id,'receiptId',v_receipt.id),
    'orphan-verification:'||v_receipt.id,p_correlation_id);
  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
  values(p_issue_id,'CLOSE_ORPHAN_VERIFICATION',trim(p_actor_label),'admin',trim(p_reason),
    jsonb_build_object('recordVersion',p_expected_record_version),
    jsonb_build_object('status','RESOLVED','recordVersion',v_issue.record_version,'receiptId',v_receipt.id));
  return jsonb_build_object('duplicate',false,'receiptId',v_receipt.id,
    'receiptOutcome','SUCCEEDED','recordVersion',v_issue.record_version,'correlationId',p_correlation_id);
end;
$$;

revoke all on function public.close_orphan_verification_case(uuid,text,bigint,text,uuid,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.close_orphan_verification_case(uuid,text,bigint,text,uuid,text,text,boolean,uuid) to service_role;
