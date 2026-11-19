-- Database actions for audited review, release and requester delivery.
-- Access revocation and the existing-export backfill are separate release units.

create or replace function public.inspect_ops_data_access_export(
  p_issue_id uuid,p_export_id uuid,p_actor_principal_id uuid,p_actor_label text,
  p_environment text,p_sensitive_assurance boolean,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_principal public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_export public.tailor_data_exports%rowtype;
begin
  if p_issue_id is null or p_export_id is null or p_actor_principal_id is null
    or p_correlation_id is null or p_sensitive_assurance is distinct from true
    or public.current_ops_environment() <> upper(trim(coalesce(p_environment,''))) then
    raise exception 'Protected privacy review required.' using errcode='42501';
  end if;
  select * into v_principal from public.ops_workforce_principals where id=p_actor_principal_id;
  select * into v_issue from public.ops_issues where id=p_issue_id;
  select * into v_export from public.tailor_data_exports where id=p_export_id;
  if v_principal.id is null or v_principal.status <> 'ACTIVE'
    or not (lower(p_environment)=any(v_principal.permitted_environments))
    or not (v_principal.roles && array['admin','customer_success']::text[])
    or v_issue.id is null or v_issue.issue_type <> 'DATA_ACCESS_REQUEST'
    or v_issue.environment <> upper(p_environment) or v_issue.provenance='UNKNOWN'
    or coalesce(v_issue.metadata->>'data_export_id',v_issue.metadata->>'tailor_export_id') <> p_export_id::text
    or v_export.id is null or v_export.tailor_user_id::text <> v_issue.user_id then
    raise exception 'Privacy evidence access denied.' using errcode='42501';
  end if;
  insert into public.ops_case_events(issue_id,event_type,visibility,sensitivity,actor_principal_id,
    actor_label,summary,payload,idempotency_key,correlation_id)
  values(p_issue_id,'EVIDENCE_ACCESS','INTERNAL','HIGHLY_RESTRICTED',p_actor_principal_id,
    trim(p_actor_label),'Protected data export opened for privacy review.',
    jsonb_build_object('exportId',p_export_id),
    'data-access-inspect:'||p_correlation_id,p_correlation_id);
  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
  values(p_issue_id,'DATA_ACCESS_EVIDENCE_ACCESS',trim(p_actor_label),array_to_string(v_principal.roles,','),
    'Protected review of export package.',null,jsonb_build_object('exportId',p_export_id));
  return jsonb_build_object('exportPackage',v_export.metadata->'export_package',
    'exportStatus',v_export.status,'expiresAt',v_export.expires_at,
    'exportFingerprint',md5((v_export.metadata->'export_package')::text));
end;
$$;

create or replace function public.perform_ops_data_access_release(
  p_issue_id uuid, p_export_id uuid, p_reason text,
  p_expected_record_version bigint, p_expected_export_fingerprint text, p_idempotency_key text,
  p_actor_principal_id uuid, p_actor_label text,
  p_environment text, p_sensitive_assurance boolean, p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_principal public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_export public.tailor_data_exports%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_now timestamptz := now();
begin
  if p_issue_id is null or p_export_id is null or p_actor_principal_id is null
    or p_correlation_id is null or p_expected_record_version is null
    or p_expected_export_fingerprint is null
    or p_expected_export_fingerprint !~ '^[0-9a-f]{32}$'
    or length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180
    or length(trim(coalesce(p_actor_label,''))) not between 3 and 180
    or length(trim(coalesce(p_reason,''))) not between 12 and 1000 then
    raise exception 'Complete reviewed export action is required.' using errcode='22023';
  end if;
  if p_sensitive_assurance is distinct from true then
    raise exception 'Fresh protected access is required.' using errcode='42501';
  end if;
  if public.current_ops_environment() <> upper(trim(coalesce(p_environment,''))) then
    raise exception 'Ops environment mismatch.' using errcode='42501';
  end if;
  select * into v_principal from public.ops_workforce_principals
    where id=p_actor_principal_id for share;
  if v_principal.id is null or v_principal.status <> 'ACTIVE'
    or not (lower(p_environment)=any(v_principal.permitted_environments))
    or not (v_principal.roles && array['admin','customer_success']::text[]) then
    raise exception 'Privacy workforce access required.' using errcode='42501';
  end if;
  select * into v_issue from public.ops_issues where id=p_issue_id for update;
  if v_issue.id is null or v_issue.issue_type <> 'DATA_ACCESS_REQUEST'
    or v_issue.environment <> upper(p_environment) or v_issue.provenance='UNKNOWN'
    or v_issue.canonical_status in ('RESOLVED','CLOSED') then
    raise exception 'Active data-access case required.' using errcode='42501';
  end if;
  select * into v_receipt from public.ops_action_receipts
    where issue_id=p_issue_id and idempotency_key=trim(p_idempotency_key);
  if v_receipt.id is not null then
    return jsonb_build_object('duplicate',true,'receiptId',v_receipt.id,
      'receiptOutcome',v_receipt.outcome,'recordVersion',v_receipt.resulting_record_version);
  end if;
  if v_issue.record_version <> p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%',v_issue.record_version using errcode='40001';
  end if;
  if coalesce(v_issue.metadata->>'data_export_id',v_issue.metadata->>'tailor_export_id') <> p_export_id::text then
    raise exception 'Export does not belong to case.' using errcode='42501';
  end if;
  select * into v_export from public.tailor_data_exports where id=p_export_id for update;
  if v_export.id is null or v_export.tailor_user_id::text <> v_issue.user_id
    or v_export.status <> 'IN_REVIEW' or v_export.expires_at is null or v_export.expires_at <= v_now
    or jsonb_typeof(v_export.metadata->'export_package') <> 'object'
    or md5((v_export.metadata->'export_package')::text) <> p_expected_export_fingerprint
    or (case when jsonb_typeof(v_export.metadata->'export_package'->'generationWarnings')='array'
      then jsonb_array_length(v_export.metadata->'export_package'->'generationWarnings')
      else 1 end) <> 0 then
    raise exception 'Complete current export required before release.' using errcode='55000';
  end if;
  update public.tailor_data_exports
    set status='READY', metadata=metadata || jsonb_build_object('released_at',v_now,'released_by',p_actor_principal_id)
    where id=p_export_id;
  update public.ops_issues set canonical_status='IN_PROGRESS',status='IN_REVIEW'
    where id=p_issue_id and canonical_status in ('NEW','TRIAGED','IN_PROGRESS','ESCALATED');
  select * into v_issue from public.ops_issues where id=p_issue_id;
  insert into public.ops_action_receipts(issue_id,action_key,idempotency_key,actor_principal_id,
    expected_record_version,resulting_record_version,outcome,human_status,correlation_id,
    side_effects,blockers,next_action,completed_at)
  values(p_issue_id,'DATA_ACCESS_RELEASE',trim(p_idempotency_key),p_actor_principal_id,
    p_expected_record_version,v_issue.record_version,'SUCCEEDED',
    'Reviewed export released for requester download.',p_correlation_id,
    jsonb_build_array(jsonb_build_object('type','EXPORT_RELEASE','id',p_export_id)),
    '[]'::jsonb,'Wait for requester download.',v_now) returning * into v_receipt;
  insert into public.ops_case_events(issue_id,event_type,visibility,sensitivity,actor_principal_id,
    actor_label,from_status,to_status,summary,payload,idempotency_key,correlation_id)
  values(p_issue_id,'DECISION','INTERNAL','HIGHLY_RESTRICTED',p_actor_principal_id,
    trim(p_actor_label),v_export.status,'READY','Reviewed data export released to the requester.',
    jsonb_build_object('exportId',p_export_id,'receiptId',v_receipt.id,'reason',trim(p_reason)),
    'data-access-release:'||v_receipt.id,p_correlation_id);
  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
  values(p_issue_id,'DATA_ACCESS_RELEASE',trim(p_actor_label),array_to_string(v_principal.roles,','),
    trim(p_reason),jsonb_build_object('exportStatus',v_export.status,'recordVersion',p_expected_record_version),
    jsonb_build_object('exportStatus','READY','recordVersion',v_issue.record_version,'receiptId',v_receipt.id));
  return jsonb_build_object('duplicate',false,'receiptId',v_receipt.id,'receiptOutcome','SUCCEEDED',
    'recordVersion',v_issue.record_version,'exportStatus','READY','correlationId',p_correlation_id);
end;
$$;

create or replace function public.deliver_data_access_export(p_export_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_export public.tailor_data_exports%rowtype;
  v_issue public.ops_issues%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_correlation uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  if p_export_id is null or p_user_id is null then
    raise exception 'Export and requester are required.' using errcode='22023';
  end if;
  select * into v_export from public.tailor_data_exports where id=p_export_id for update;
  if v_export.id is null or v_export.tailor_user_id <> p_user_id
    or v_export.status not in ('READY','DELIVERED')
    or v_export.expires_at is null or v_export.expires_at <= v_now or not (v_export.metadata ? 'released_at') then
    raise exception 'Released, unexpired export for requester required.' using errcode='42501';
  end if;
  if v_export.status='DELIVERED' then
    return jsonb_build_object('duplicate',true,'exportPackage',v_export.metadata->'export_package');
  end if;
  select * into v_issue from public.ops_issues
    where issue_type='DATA_ACCESS_REQUEST' and user_id=p_user_id::text
      and coalesce(metadata->>'data_export_id',metadata->>'tailor_export_id')=p_export_id::text
      and environment=public.current_ops_environment()
    order by created_at desc limit 1 for update;
  if v_issue.id is null or v_issue.canonical_status in ('RESOLVED','CLOSED') then
    raise exception 'Active matching privacy case required.' using errcode='42501';
  end if;
  update public.tailor_data_exports set status='DELIVERED',delivered_at=v_now where id=p_export_id;
  update public.ops_issues set canonical_status='RESOLVED',status='RESOLVED',resolved_at=v_now
    where id=v_issue.id;
  select * into v_issue from public.ops_issues where id=v_issue.id;
  insert into public.ops_action_receipts(issue_id,action_key,idempotency_key,actor_principal_id,
    expected_record_version,resulting_record_version,outcome,human_status,correlation_id,
    side_effects,blockers,completed_at)
  values(v_issue.id,'DATA_ACCESS_DELIVER','data-access-deliver:'||p_export_id,null,
    v_issue.record_version-1,v_issue.record_version,'SUCCEEDED',
    'Released export returned to the authenticated requester.',v_correlation,
    jsonb_build_array(jsonb_build_object('type','EXPORT_DOWNLOAD','id',p_export_id)),
    '[]'::jsonb,v_now) returning * into v_receipt;
  insert into public.ops_case_events(issue_id,event_type,visibility,sensitivity,actor_label,
    from_status,to_status,summary,payload,idempotency_key,correlation_id)
  values(v_issue.id,'CUSTOMER_COMMUNICATION','INTERNAL','SENSITIVE','requester:'||p_user_id,
    'IN_PROGRESS','RESOLVED','Released export returned through authenticated download.',
    jsonb_build_object('exportId',p_export_id,'receiptId',v_receipt.id),
    'data-access-deliver:'||p_export_id,v_correlation);
  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
  values(v_issue.id,'DATA_ACCESS_DELIVER','requester:'||p_user_id,'REQUESTER',
    'Authenticated requester downloaded the reviewed export.',
    jsonb_build_object('exportStatus','READY'),
    jsonb_build_object('exportStatus','DELIVERED','receiptId',v_receipt.id));
  return jsonb_build_object('duplicate',false,'exportPackage',v_export.metadata->'export_package',
    'receiptId',v_receipt.id,'correlationId',v_correlation);
end;
$$;

revoke all on function public.perform_ops_data_access_release(uuid,uuid,text,bigint,text,text,uuid,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.perform_ops_data_access_release(uuid,uuid,text,bigint,text,text,uuid,text,text,boolean,uuid) to service_role;
revoke all on function public.inspect_ops_data_access_export(uuid,uuid,uuid,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.inspect_ops_data_access_export(uuid,uuid,uuid,text,text,boolean,uuid) to service_role;
revoke all on function public.deliver_data_access_export(uuid,uuid) from public,anon,authenticated;
grant execute on function public.deliver_data_access_export(uuid,uuid) to service_role;
