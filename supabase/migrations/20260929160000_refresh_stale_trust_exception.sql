-- Preserve all existing administrator, evidence, version and replay gates.
alter function public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean)
  rename to ops_trust_exception_action_snapshot_v1;
revoke all on function public.ops_trust_exception_action_snapshot_v1(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean) from public,anon,authenticated,service_role;

create function public.ops_trust_exception_action(
  p_action text, p_profile_id uuid, p_actor_principal_id uuid,
  p_environment text, p_sensitive_assurance boolean, p_reason text,
  p_evidence_reference text, p_idempotency_key text, p_correlation_id uuid,
  p_issue_id uuid default null, p_expected_record_version bigint default null,
  p_public_evidence_reviewed boolean default false,
  p_video_waiver_acknowledged boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  result jsonb;
  c public.ops_issues%rowtype;
  p public.tailor_profiles%rowtype;
  r public.ops_action_receipts%rowtype;
  actor_email text;
  before_snapshot jsonb;
begin
  -- The original READ performs full protected administrator authorization and
  -- locks the profile/case. Locks remain held for this transaction.
  if upper(trim(p_action)) in ('READ','REFRESH') then
    result := public.ops_trust_exception_action_snapshot_v1('READ',p_profile_id,p_actor_principal_id,
      p_environment,p_sensitive_assurance,'','','',p_correlation_id);
    select * into p from public.tailor_profiles where id=p_profile_id;
    if result->'case' <> 'null'::jsonb then
      select * into c from public.ops_issues where id=(result->'case'->>'id')::uuid;
      result := jsonb_set(result,'{case,snapshotStale}',to_jsonb(
        not (c.metadata ? 'profileUpdatedAt') or
        p.updated_at is distinct from (c.metadata->>'profileUpdatedAt')::timestamptz));
    end if;
    if upper(trim(p_action))='READ' then return result; end if;
    if c.id is null or c.id is distinct from p_issue_id then
      raise exception 'Exact exception case required' using errcode='42501';
    end if;
    if length(trim(coalesce(p_reason,''))) not between 20 and 1000
      or length(trim(coalesce(p_evidence_reference,''))) not between 8 and 500
      or length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180
      or p_public_evidence_reviewed is distinct from true
      or p_video_waiver_acknowledged is distinct from true then
      raise exception 'Fresh review, reason and recruitment evidence required' using errcode='22023';
    end if;
    select * into r from public.ops_action_receipts where issue_id=c.id and idempotency_key=trim(p_idempotency_key);
    if r.id is not null then
      if r.action_key <> 'TRUST_EXCEPTION_REFRESH' then raise exception 'Replay key belongs to another action' using errcode='22023'; end if;
      return result||jsonb_build_object('duplicate',true,'receiptId',r.id);
    end if;
    if c.canonical_status in ('RESOLVED','CLOSED') then raise exception 'Exception already decided' using errcode='55000'; end if;
    if p_expected_record_version is null or c.record_version<>p_expected_record_version then
      raise exception 'Case version changed' using errcode='40001';
    end if;
    if p.is_live or p.is_verified or nullif(trim(p.trust_verification_video_path),'') is not null
      or p.id_verification_status not in ('NOT_SUBMITTED','REJECTED') then
      raise exception 'Use the normal trust workflow for this profile' using errcode='55000';
    end if;
    before_snapshot:=c.metadata;
    select email into actor_email from public.ops_workforce_principals where id=p_actor_principal_id;
    update public.ops_issues set metadata=metadata||jsonb_build_object(
      'profileUpdatedAt',p.updated_at,'originalVerificationStatus',p.id_verification_status,
      'reason',trim(p_reason),'evidenceReference',trim(p_evidence_reference),
      'refreshedBy',actor_email,'refreshedAt',now(),'videoReviewed',false),
      recommended_action='Evidence refreshed. Review the current profile again before a separate waiver decision.'
      where id=c.id returning * into c;
    insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
      values(c.id,'TRUST_EXCEPTION_REFRESH',actor_email,'admin',trim(p_reason),before_snapshot,c.metadata);
    insert into public.ops_case_events(issue_id,event_type,visibility,sensitivity,actor_principal_id,
      actor_label,summary,payload,idempotency_key,correlation_id)
      values(c.id,'EVIDENCE_REQUEST','INTERNAL','HIGHLY_RESTRICTED',p_actor_principal_id,
      actor_email,'Waiver evidence refreshed; no approval performed',
      jsonb_build_object('before',before_snapshot,'after',c.metadata),trim(p_idempotency_key),p_correlation_id);
    insert into public.ops_action_receipts(issue_id,action_key,idempotency_key,actor_principal_id,
      expected_record_version,resulting_record_version,outcome,human_status,correlation_id,side_effects,blockers,next_action,completed_at)
      values(c.id,'TRUST_EXCEPTION_REFRESH',trim(p_idempotency_key),p_actor_principal_id,
      p_expected_record_version,c.record_version,'SUCCEEDED','Evidence refreshed; storefront unchanged.',
      p_correlation_id,'[]'::jsonb,'[]'::jsonb,c.recommended_action,now()) returning * into r;
    return jsonb_build_object('ok',true,'receiptId',r.id,'case',jsonb_build_object('id',c.id,
      'caseNumber',c.case_number,'recordVersion',c.record_version,'status',c.canonical_status,
      'metadata',c.metadata,'snapshotStale',false));
  end if;
  return public.ops_trust_exception_action_snapshot_v1(p_action,p_profile_id,p_actor_principal_id,
    p_environment,p_sensitive_assurance,p_reason,p_evidence_reference,p_idempotency_key,p_correlation_id,
    p_issue_id,p_expected_record_version,p_public_evidence_reviewed,p_video_waiver_acknowledged);
end;
$$;
revoke all on function public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean) from public,anon,authenticated;
grant execute on function public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean) to service_role;
