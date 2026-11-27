-- Development-only forward recovery for terminal FINALIZE failure.
-- Rollback: restore prepare/complete from 20261118190140 and drop the recovery RPCs.

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.tailor_claim_finalize_receipts'::regclass
    and conname='tailor_claim_finalize_receipts_outcome_check'
    and pg_get_constraintdef(oid) like '%IN_PROGRESS%SUCCEEDED%FAILED%') then
    raise exception 'FINALIZE_OUTCOME_CONSTRAINT_DRIFT';
  end if;
end;
$$;

create or replace function public.begin_tailor_profile_finalize_failure(
  p_receipt_id uuid,p_user_id uuid,p_failure_code text
) returns text
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_receipt public.tailor_claim_finalize_receipts%rowtype;
begin
  if p_failure_code not in ('FINALIZE_READINESS_CHANGED','PROMOTED_MANIFEST_STALE',
    'FINALIZE_MEDIA_CHANGED','PROMOTED_ASSET_INVALID','PROMOTED_MEDIA_INCOMPLETE',
    'SOURCE_MANIFEST_INVALID') then
    raise exception 'INVALID_FINALIZE_FAILURE_CODE' using errcode='22023';
  end if;
  select * into v_receipt from public.tailor_claim_finalize_receipts
    where id=p_receipt_id and user_id=p_user_id for update;
  if not found then return 'MISSING'; end if;
  if v_receipt.outcome='SUCCEEDED' then return 'LIVE'; end if;
  if v_receipt.outcome='FAILED' then return 'FAILED'; end if;
  if v_receipt.outcome='CLEANING' then return 'CLEANING'; end if;
  update public.tailor_claim_finalize_receipts
    set outcome='CLEANING',failure_code=p_failure_code
    where id=v_receipt.id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'SYSTEM','tailor_claim.finalize_cleanup_started','warning',
    jsonb_build_object('invite_id',v_receipt.invite_id,'receipt_id',v_receipt.id,
      'failure_code',p_failure_code));
  return 'CLEANING';
end;
$$;

create or replace function public.finish_tailor_profile_finalize_failure(
  p_receipt_id uuid,p_user_id uuid
) returns boolean
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_receipt public.tailor_claim_finalize_receipts%rowtype;
  v_invite public.tailor_claim_invites%rowtype;
begin
  select * into v_receipt from public.tailor_claim_finalize_receipts
    where id=p_receipt_id and user_id=p_user_id for update;
  if not found then return false; end if;
  if v_receipt.outcome='FAILED' then return true; end if;
  if v_receipt.outcome<>'CLEANING' then return false; end if;
  select * into v_invite from public.tailor_claim_invites
    where id=v_receipt.invite_id for update;
  if not found or v_invite.status<>'FINALIZING' then return false; end if;

  update public.media_assets a
    set status='FAILED',availability_state='QUARANTINED',public_url=null,
      is_primary=false,portfolio_position=null,updated_at=now()
    where a.owner_user_id=p_user_id
      and a.tailor_profile_id::text=v_invite.tailor_profile_id::text
      and a.metadata->>'source'='TAILOR_CLAIM'
      and a.metadata->>'draft_media_id' in
        (select source->>'id' from jsonb_array_elements(v_receipt.source_manifest) source);
  update public.tailor_draft_media d set media_asset_id=null,updated_at=now()
    where d.invite_id=v_invite.id and d.id::text in
      (select source->>'id' from jsonb_array_elements(v_receipt.source_manifest) source);
  update public.tailor_claim_invites set status='CLAIMED_AWAITING_EMAIL',updated_at=now()
    where id=v_invite.id;
  update public.tailor_profiles set lifecycle_state='CLAIMED_AWAITING_EMAIL',updated_at=now()
    where id::text=v_invite.tailor_profile_id::text and lifecycle_state='FINALIZING';
  update public.tailor_claim_finalize_receipts
    set outcome='FAILED',completed_at=now() where id=v_receipt.id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'SYSTEM','tailor_claim.finalize_failed_reset','warning',
    jsonb_build_object('invite_id',v_invite.id,'receipt_id',v_receipt.id,
      'failure_code',v_receipt.failure_code));
  return true;
end;
$$;

revoke all on function public.begin_tailor_profile_finalize_failure(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.finish_tailor_profile_finalize_failure(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.begin_tailor_profile_finalize_failure(uuid,uuid,text)
  to service_role;
grant execute on function public.finish_tailor_profile_finalize_failure(uuid,uuid)
  to service_role;
alter table public.tailor_claim_finalize_receipts
  drop constraint tailor_claim_finalize_receipts_outcome_check,
  add constraint tailor_claim_finalize_receipts_outcome_check
    check (outcome in ('IN_PROGRESS','CLEANING','SUCCEEDED','FAILED'));
alter table public.tailor_claim_finalize_receipts
  drop constraint tailor_claim_finalize_receipts_check,
  add constraint tailor_claim_finalize_receipts_check
    check ((outcome in ('IN_PROGRESS','CLEANING'))=(completed_at is null));

create or replace function public.prepare_tailor_profile_finalize(
  p_user_id uuid,
  p_idempotency_key text
) returns table(result text,receipt_id uuid,profile_id text,source_manifest jsonb,response jsonb)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_auth auth.users%rowtype;
  v_receipt public.tailor_claim_finalize_receipts%rowtype;
  v_expected_ids uuid[];
  v_consented_ids uuid[];
  v_currency_min integer;
  v_currency_max integer;
  v_failed_receipt_id uuid;
  v_fresh_manifest jsonb;
begin
  if p_user_id is null or char_length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180 then
    result:='INVALID_FINALIZE'; return next; return;
  end if;
  select * into v_invite from public.tailor_claim_invites
    where tailor_user_id=p_user_id and status in ('CLAIMED_AWAITING_EMAIL','FINALIZING','LIVE') for update;
  if not found then result:='UNAVAILABLE'; return next; return; end if;
  select * into v_profile from public.tailor_profiles where id::text=v_invite.tailor_profile_id::text for update;
  select * into v_auth from auth.users where id=p_user_id for update;
  select * into v_receipt from public.tailor_claim_finalize_receipts where invite_id=v_invite.id for update;
  if found then
    if v_receipt.user_id<>p_user_id then
      result:='FINALIZE_IN_PROGRESS'; return next; return;
    end if;
    if v_receipt.outcome='CLEANING' then
      result:='CLEANUP_PENDING'; receipt_id:=v_receipt.id;
      profile_id:=v_invite.tailor_profile_id::text; source_manifest:=v_receipt.source_manifest;
      return next; return;
    end if;
    if v_receipt.outcome='FAILED' then
      v_failed_receipt_id:=v_receipt.id;
    else
      if v_receipt.idempotency_key<>trim(p_idempotency_key) then
        result:='FINALIZE_IN_PROGRESS'; return next; return;
      end if;
      result:=case v_receipt.outcome when 'SUCCEEDED' then 'LIVE' else 'PREPARED' end;
      receipt_id:=v_receipt.id; profile_id:=v_invite.tailor_profile_id::text;
      source_manifest:=v_receipt.source_manifest; response:=v_receipt.response_payload;
      return next; return;
    end if;
  end if;
  v_currency_min:=case v_profile.currency when 'NGN' then 500000 when 'GHS' then 5000 when 'KES' then 50000 else 1000 end;
  v_currency_max:=case v_profile.currency when 'NGN' then 999999900 when 'GHS' then 100000000 when 'KES' then 500000000 when 'USD' then 10000000 when 'GBP' then 10000000 when 'EUR' then 10000000 when 'CAD' then 10000000 else null end;
  if v_invite.status<>'CLAIMED_AWAITING_EMAIL' or v_profile.lifecycle_state<>'CLAIMED_AWAITING_EMAIL'
     or v_auth.email_confirmed_at is null
     or not exists(select 1 from public.users u where u.id=p_user_id and u.phone_verified_at is not null)
     or v_invite.approved_at is null or v_invite.approved_by_principal is null
     or v_invite.marketplace_placement is null or not v_invite.public_evidence_reviewed
     or not v_invite.video_waiver_acknowledged or v_invite.consent_recorded_at is null
     or v_invite.consent_text_version is null or jsonb_typeof(v_invite.consent_media_manifest)<>'array'
     or length(trim(v_profile.display_name))<2 or length(trim(v_profile.location))<1
     or length(trim(coalesce(v_profile.bio,'')))<80
     or coalesce(cardinality(v_profile.languages),0) not between 1 and 12
     or coalesce(cardinality(v_profile.specialty_tags),0) not between 1 and 20
     or v_currency_max is null or v_profile.price_range_min is null or v_profile.price_range_max is null
     or v_profile.price_range_min<v_currency_min or v_profile.price_range_max<v_profile.price_range_min
     or v_profile.price_range_max>v_currency_max then
    result:='NOT_READY'; return next; return;
  end if;
  select coalesce(array_agg(m.id order by m.id::text),'{}'::uuid[]) into v_expected_ids
    from public.tailor_draft_media m where m.invite_id=v_invite.id
      and m.confirmed_at is not null and m.moderation_status='APPROVED';
  begin
    select coalesce(array_agg((value#>>'{}')::uuid order by value#>>'{}'),'{}'::uuid[])
      into v_consented_ids from jsonb_array_elements(v_invite.consent_media_manifest);
  exception when invalid_text_representation then result:='CONSENT_MANIFEST_INVALID'; return next; return;
  end;
  if v_expected_ids is distinct from v_consented_ids
     or not exists(select 1 from public.tailor_draft_media where invite_id=v_invite.id and media_kind='AVATAR' and id=any(v_expected_ids))
     or not exists(select 1 from public.tailor_draft_media where invite_id=v_invite.id and media_kind='PHOTO' and id=any(v_expected_ids)) then
    result:='CONSENT_MANIFEST_STALE'; return next; return;
  end if;
  source_manifest:=(select jsonb_agg(jsonb_build_object(
    'id',m.id,'storagePath',m.storage_path,'kind',m.media_kind,'contentType',m.content_type,
    'byteSize',m.byte_size,'sha256',m.sha256,'width',m.width,'height',m.height,
    'durationMs',m.duration_ms,'sortOrder',m.sort_order,'isCover',m.is_cover,
    'focalX',m.focal_x,'focalY',m.focal_y
  ) order by m.sort_order,m.created_at) from public.tailor_draft_media m where m.id=any(v_expected_ids));
  v_fresh_manifest:=source_manifest;
  if v_failed_receipt_id is null then
    insert into public.tailor_claim_finalize_receipts(invite_id,user_id,idempotency_key,source_manifest)
      values(v_invite.id,p_user_id,trim(p_idempotency_key),source_manifest) returning id into receipt_id;
  else
    update public.tailor_claim_finalize_receipts
    set idempotency_key=trim(p_idempotency_key),source_manifest=v_fresh_manifest,
      outcome='IN_PROGRESS',failure_code=null,response_payload=null,completed_at=null,
      created_at=now()
    where id=v_failed_receipt_id returning id into receipt_id;
    insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
      p_user_id::text,'TAILOR','tailor_claim.finalize_reprepared','info',
      jsonb_build_object('invite_id',v_invite.id,'receipt_id',receipt_id));
  end if;
  update public.tailor_claim_invites set status='FINALIZING',updated_at=now() where id=v_invite.id;
  update public.tailor_profiles set lifecycle_state='FINALIZING',updated_at=now() where id::text=v_invite.tailor_profile_id::text;
  result:='PREPARED'; profile_id:=v_invite.tailor_profile_id::text; return next;
end;
$$;

create or replace function public.complete_tailor_profile_finalize(
  p_receipt_id uuid,
  p_user_id uuid,
  p_promoted_manifest jsonb
) returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_receipt public.tailor_claim_finalize_receipts%rowtype;
  v_invite public.tailor_claim_invites%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_source_ids uuid[];
  v_promoted_ids uuid[];
  v_avatar_url text;
  v_photo_urls text[];
  v_video_urls text[];
  v_response jsonb;
  v_auth auth.users%rowtype;
begin
  if jsonb_typeof(p_promoted_manifest)<>'array' then raise exception 'PROMOTED_MANIFEST_INVALID' using errcode='22023'; end if;
  select * into v_receipt from public.tailor_claim_finalize_receipts where id=p_receipt_id and user_id=p_user_id for update;
  if not found then raise exception 'FINALIZE_RECEIPT_MISSING' using errcode='22023'; end if;
  if v_receipt.outcome='SUCCEEDED' then return v_receipt.response_payload; end if;
  if v_receipt.outcome<>'IN_PROGRESS' then
    raise exception 'FINALIZE_CLEANUP_PENDING' using errcode='P1105';
  end if;
  select * into v_invite from public.tailor_claim_invites where id=v_receipt.invite_id for update;
  select * into v_profile from public.tailor_profiles where id::text=v_invite.tailor_profile_id::text for update;
  select * into v_auth from auth.users where id=p_user_id for update;
  if v_invite.status<>'FINALIZING' or v_profile.lifecycle_state<>'FINALIZING' then raise exception 'FINALIZE_STATE_CHANGED' using errcode='40001'; end if;
  if v_auth.email_confirmed_at is null
     or not exists(select 1 from public.users u where u.id=p_user_id and u.phone_verified_at is not null)
     or v_invite.approved_at is null or v_invite.approved_by_principal is null
     or v_invite.marketplace_placement is null or not v_invite.public_evidence_reviewed
     or not v_invite.video_waiver_acknowledged or v_invite.consent_recorded_at is null then
    raise exception 'FINALIZE_READINESS_CHANGED' using errcode='P1101';
  end if;
  select array_agg((value->>'id')::uuid order by value->>'id') into v_source_ids from jsonb_array_elements(v_receipt.source_manifest);
  select array_agg((value->>'draftMediaId')::uuid order by value->>'draftMediaId') into v_promoted_ids from jsonb_array_elements(p_promoted_manifest);
  if v_source_ids is distinct from v_promoted_ids then raise exception 'PROMOTED_MANIFEST_STALE' using errcode='P1102'; end if;
  if exists(select 1 from unnest(v_source_ids) as source(source_id) left join public.tailor_draft_media m on m.id=source.source_id
    where m.id is null or m.invite_id<>v_invite.id or m.confirmed_at is null or m.moderation_status<>'APPROVED') then
    raise exception 'FINALIZE_MEDIA_CHANGED' using errcode='P1103';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_promoted_manifest) p
    left join public.media_assets a on a.id=(p->>'mediaAssetId')::uuid
    where a.id is null or a.owner_user_id<>p_user_id or a.tailor_profile_id::text<>v_profile.id::text
      or a.status<>'ACTIVE' or a.moderation_status<>'APPROVED'
      or a.public_url is distinct from p->>'publicUrl'
  ) then raise exception 'PROMOTED_ASSET_INVALID' using errcode='P1104'; end if;
  select max(p->>'publicUrl') filter(where s->>'kind'='AVATAR'),
    coalesce(array_agg(p->>'publicUrl' order by (s->>'sortOrder')::integer) filter(where s->>'kind'='PHOTO'),'{}'::text[]),
    coalesce(array_agg(p->>'publicUrl' order by (s->>'sortOrder')::integer) filter(where s->>'kind'='VIDEO'),'{}'::text[])
    into v_avatar_url,v_photo_urls,v_video_urls
  from jsonb_array_elements(v_receipt.source_manifest) s
  join jsonb_array_elements(p_promoted_manifest) p on p->>'draftMediaId'=s->>'id';
  if v_avatar_url is null or cardinality(v_photo_urls)<1 then raise exception 'PROMOTED_MEDIA_INCOMPLETE' using errcode='P1106'; end if;
  perform set_config('drape.identity_verification_trusted_write','true',true);
  update public.tailor_profiles set avatar_url=v_avatar_url,portfolio_photo_urls=v_photo_urls,
    portfolio_video_urls=v_video_urls,id_verification_status='VERIFIED',id_verified_at=now(),
    id_verification_method='STAFF_PREAPPROVAL',
    id_verification_metadata=coalesce(id_verification_metadata,'{}'::jsonb)||jsonb_build_object(
      'verification_type','STAFF_PREAPPROVAL','approved_by_principal',v_invite.approved_by_principal,
      'approval_reason',v_invite.approval_reason,'evidence_ref',v_invite.evidence_ref,
      'public_evidence_reviewed',v_invite.public_evidence_reviewed,
      'challenge_video_waived',v_invite.video_waiver_acknowledged),
    is_verified=true,is_live=true,lifecycle_state='LIVE',updated_at=now()
    where id::text=v_profile.id::text;
  update public.tailor_claim_invites set status='LIVE',updated_at=now() where id=v_invite.id;
  update public.tailor_draft_media d set media_asset_id=(p->>'mediaAssetId')::uuid,updated_at=now()
    from jsonb_array_elements(p_promoted_manifest) p where d.id=(p->>'draftMediaId')::uuid;
  v_response:=jsonb_build_object('finalized',true,'receiptId',v_receipt.id,'profileId',v_profile.id::text,'state','LIVE','next','ADD_PAYOUTS');
  update public.tailor_claim_finalize_receipts set outcome='SUCCEEDED',response_payload=v_response,completed_at=now() where id=v_receipt.id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.finalized','info',jsonb_build_object(
      'invite_id',v_invite.id,'profile_id',v_profile.id::text,'receipt_id',v_receipt.id,
      'media_count',jsonb_array_length(p_promoted_manifest),'preapproval_applied',true));
  return v_response;
end;
$$;
