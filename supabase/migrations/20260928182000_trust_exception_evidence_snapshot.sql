-- Fail closed if the profile changed after the administrator requested a waiver.
-- Rejecting a waiver never changes profile state and may close a stale request.
do $migration$
declare definition text; old_request text; new_request text; old_gate text; new_gate text;
begin
  select pg_get_functiondef('public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean)'::regprocedure) into definition;
  old_request := $old$'originalVerificationStatus',p.id_verification_status)$old$;
  new_request := $new$'originalVerificationStatus',p.id_verification_status,
        'profileUpdatedAt',p.updated_at)$new$;
  old_gate := $old$if p.id_verification_status::text is distinct from c.metadata->>'originalVerificationStatus'
      or p.is_live or p.is_verified or nullif(trim(p.trust_verification_video_path),'') is not null then$old$;
  new_gate := $new$if v_action='APPROVE' and (
      p.id_verification_status::text is distinct from c.metadata->>'originalVerificationStatus'
      or p.is_live or p.is_verified or nullif(trim(p.trust_verification_video_path),'') is not null
      or not (c.metadata ? 'profileUpdatedAt')
      or p.updated_at is distinct from (c.metadata->>'profileUpdatedAt')::timestamptz
    ) then$new$;
  if position(old_request in definition)=0 or position(old_gate in definition)=0 then
    raise exception 'Expected exception evidence predicates unavailable';
  end if;
  execute replace(replace(definition,old_request,new_request),old_gate,new_gate);
end;
$migration$;
