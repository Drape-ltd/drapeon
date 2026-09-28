-- Explicit product decision: administrator-reviewed recruitment waivers are a
-- separate workflow. Normal submission/approval RPCs remain unchanged.
create or replace function public.ops_trust_exception_action(
  p_action text, p_profile_id uuid, p_actor_principal_id uuid,
  p_environment text, p_sensitive_assurance boolean, p_reason text,
  p_evidence_reference text, p_idempotency_key text, p_correlation_id uuid,
  p_issue_id uuid default null, p_expected_record_version bigint default null,
  p_public_evidence_reviewed boolean default false,
  p_video_waiver_acknowledged boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.ops_workforce_principals%rowtype;
  p public.tailor_profiles%rowtype;
  c public.ops_issues%rowtype;
  r public.ops_action_receipts%rowtype;
  v_action text := upper(trim(coalesce(p_action,'')));
  v_before jsonb;
  v_after jsonb;
begin
  if v_action not in ('READ','REQUEST','APPROVE','REJECT') or p_profile_id is null
    or p_correlation_id is null then raise exception 'Invalid exception command' using errcode='22023'; end if;
  select * into a from public.ops_workforce_principals where id=p_actor_principal_id for share;
  if a.id is null or a.status<>'ACTIVE' or not ('admin'=any(a.roles))
    or not (lower(p_environment)=any(a.permitted_environments))
    or p_sensitive_assurance is distinct from true
    or public.current_ops_environment() is distinct from p_environment then
    raise exception 'Protected administrator authority required' using errcode='42501';
  end if;
  -- Serialize all requests and decisions for one profile, preventing duplicate cases.
  select * into p from public.tailor_profiles where id=p_profile_id for update;
  if p.id is null then raise exception 'Tailor profile missing' using errcode='22023'; end if;
  select * into c from public.ops_issues
  where issue_type='TAILOR_VERIFICATION_EXCEPTION' and tailor_profile_id=p.id::text
    and environment=p_environment order by created_at desc limit 1 for update;
  if v_action='READ' then
    return jsonb_build_object('ok',true,'case',case when c.id is null then null else
      jsonb_build_object('id',c.id,'caseNumber',c.case_number,'recordVersion',c.record_version,
        'status',c.canonical_status,'metadata',c.metadata) end);
  end if;
  if length(trim(coalesce(p_reason,''))) not between 20 and 1000
    or length(trim(coalesce(p_evidence_reference,''))) not between 8 and 500
    or length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180 then
    raise exception 'Reason, recruitment evidence reference and replay key required' using errcode='22023';
  end if;
  if v_action='REQUEST' then
    if c.id is not null then
      return jsonb_build_object('ok',true,'duplicate',true,'case',jsonb_build_object(
        'id',c.id,'caseNumber',c.case_number,'recordVersion',c.record_version,'status',c.canonical_status,'metadata',c.metadata));
    end if;
    if p.id_verification_status not in ('NOT_SUBMITTED','REJECTED') or p.is_live or p.is_verified
      or nullif(trim(p.trust_verification_video_path),'') is not null then
      raise exception 'Use the normal trust workflow for this profile' using errcode='55000';
    end if;
    insert into public.ops_issues(issue_type,severity,status,source,user_id,tailor_profile_id,
      related_entity_type,related_entity_id,title,description,recommended_action,dedupe_key,
      environment,provenance,queue_key,owning_team,canonical_status,sensitivity,correlation_id,metadata)
    values('TAILOR_VERIFICATION_EXCEPTION','MEDIUM','OPEN','ops-trust-exception-action',p.user_id::text,p.id::text,
      'tailor_profile',p.id::text,'Recruitment video waiver requested',trim(p_reason),
      'Protected administrator must review public evidence and explicitly accept or reject the video waiver.',
      'trust-exception:'||p_environment||':'||p.id::text,p_environment,
      case when p_environment='DEVELOPMENT' then 'QA' else 'REAL' end,
      'trust','trust','NEW','HIGHLY_RESTRICTED',p_correlation_id,
      jsonb_build_object('exceptionType','RECRUITMENT_VIDEO_WAIVER','reason',trim(p_reason),
        'evidenceReference',trim(p_evidence_reference),'requestedBy',a.email,'videoReviewed',false,
        'originalVerificationStatus',p.id_verification_status)) returning * into c;
  else
    if c.id is null or c.id is distinct from p_issue_id or c.user_id is distinct from p.user_id::text
      or c.metadata->>'exceptionType' is distinct from 'RECRUITMENT_VIDEO_WAIVER' then
      raise exception 'Exact exception case required' using errcode='42501';
    end if;
    select * into r from public.ops_action_receipts where issue_id=c.id and idempotency_key=trim(p_idempotency_key);
    if r.id is not null then
      if r.action_key is distinct from 'TRUST_EXCEPTION_'||v_action then
        raise exception 'Replay key belongs to another action' using errcode='22023';
      end if;
      return jsonb_build_object('ok',true,'duplicate',true,'receiptId',r.id,'case',jsonb_build_object(
        'id',c.id,'caseNumber',c.case_number,'recordVersion',c.record_version,'status',c.canonical_status,'metadata',c.metadata));
    end if;
    if c.canonical_status in ('RESOLVED','CLOSED') then raise exception 'Exception already decided' using errcode='55000'; end if;
    if p_expected_record_version is null or c.record_version<>p_expected_record_version then
      raise exception 'Case version changed' using errcode='40001'; end if;
    if p_public_evidence_reviewed is distinct from true or p_video_waiver_acknowledged is distinct from true then
      raise exception 'Public evidence review and video waiver acknowledgement required' using errcode='42501'; end if;
    if p.id_verification_status::text is distinct from c.metadata->>'originalVerificationStatus'
      or p.is_live or p.is_verified or nullif(trim(p.trust_verification_video_path),'') is not null then
      raise exception 'Profile changed; reread normal trust state' using errcode='55000'; end if;
    v_before := jsonb_build_object('status',p.id_verification_status,'isLive',p.is_live,'isVerified',p.is_verified);
    if v_action='APPROVE' then
      if nullif(trim(p.display_name),'') is null or nullif(trim(p.avatar_url),'') is null
        or coalesce(cardinality(p.specialty_tags),0)<1 or coalesce(cardinality(p.portfolio_photo_urls),0)<1
        or not exists(select 1 from public.users where id::text=p.user_id::text and nullif(trim(phone),'') is not null) then
        raise exception 'Non-video profile requirements missing' using errcode='55000'; end if;
      perform set_config('drape.identity_verification_trusted_write','true',true);
      update public.tailor_profiles set is_live=true,is_verified=true,id_verification_status='VERIFIED',
        id_verified_at=now(),id_verification_method='CHALLENGE_VIDEO',
        id_verification_metadata=coalesce(id_verification_metadata,'{}'::jsonb)||jsonb_build_object(
          'approval_basis','RECRUITMENT_VIDEO_WAIVER','video_waived',true,'video_reviewed',false,
          'exception_case_id',c.id,'exception_reason',trim(p_reason),'exception_actor',a.email,
          'exception_at',now(),'exception_correlation_id',p_correlation_id),updated_at=now()
      where id=p.id;
    end if;
    -- Rejecting the waiver does not pretend a video submission was rejected.
    select jsonb_build_object('status',id_verification_status,'isLive',is_live,'isVerified',is_verified)
      into v_after from public.tailor_profiles where id=p.id;
    update public.ops_issues set status='RESOLVED',canonical_status='RESOLVED',resolved_at=now(),
      assigned_to=a.email,assigned_principal_id=a.id,
      metadata=metadata||jsonb_build_object('decision',v_action,'decidedBy',a.email,'decisionReason',trim(p_reason),
        'decisionEvidenceReference',trim(p_evidence_reference),'decidedAt',now(),'videoReviewed',false),
      recommended_action=case when v_action='APPROVE' then 'Video waived; payout verification remains independent.'
        else 'Waiver rejected. Complete normal challenge-video verification.' end
    where id=c.id returning * into c;
    insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
      values(c.id,'TRUST_EXCEPTION_'||v_action,a.email,'admin',trim(p_reason),v_before,v_after);
    insert into public.audit_logs(actor_role,event,severity,payload)
      values('OPS','tailor.trust_exception_decided','warn',jsonb_build_object('profileId',p.id,
        'caseId',c.id,'actor',a.email,'decision',v_action,'reason',trim(p_reason),'videoReviewed',false,
        'correlationId',p_correlation_id,'before',v_before,'after',v_after));
  end if;
  insert into public.ops_case_events(issue_id,event_type,visibility,sensitivity,actor_principal_id,
    actor_label,summary,payload,idempotency_key,correlation_id)
  values(c.id,case when v_action='REQUEST' then 'EVIDENCE_REQUEST' else 'DECISION' end,
    'INTERNAL','HIGHLY_RESTRICTED',a.id,a.email,'Recruitment video waiver: '||v_action,
    jsonb_build_object('reason',trim(p_reason),'evidenceReference',trim(p_evidence_reference),
      'videoReviewed',false,'action',v_action),trim(p_idempotency_key),p_correlation_id);
  insert into public.ops_action_receipts(issue_id,action_key,idempotency_key,actor_principal_id,
    expected_record_version,resulting_record_version,outcome,human_status,correlation_id,side_effects,
    blockers,next_action,completed_at)
  values(c.id,'TRUST_EXCEPTION_'||v_action,trim(p_idempotency_key),a.id,
    coalesce(p_expected_record_version,1),c.record_version,'SUCCEEDED','Recruitment waiver '||lower(v_action)||' persisted.',
    p_correlation_id,'[{"type":"EMAIL","status":"NOT_REQUESTED"},{"type":"PUSH","status":"NOT_REQUESTED"}]'::jsonb,
    '[]'::jsonb,c.recommended_action,now()) returning * into r;
  return jsonb_build_object('ok',true,'receiptId',r.id,'case',jsonb_build_object('id',c.id,
    'caseNumber',c.case_number,'recordVersion',c.record_version,'status',c.canonical_status,'metadata',c.metadata));
end;
$$;
revoke all on function public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean) from public,anon,authenticated;
grant execute on function public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean) to service_role;
