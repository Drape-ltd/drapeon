insert into auth.users values
  ('00000000-0000-0000-0000-000000000001','qa@example.invalid',now());
insert into public.users values ('00000000-0000-0000-0000-000000000001',now());
insert into public.tailor_profiles
  (id,lifecycle_state,currency,display_name,location,bio,languages,specialty_tags,
   price_range_min,price_range_max,is_verified,is_live) values
  ('profile-qa','FINALIZING','NGN','Recovery QA','Lagos',
   repeat('Development-only recovery profile with confirmed details. ',2),
   array['English'],array['OTHER'],500000,600000,false,false);
insert into public.tailor_claim_invites
  (id,tailor_user_id,tailor_profile_id,status,approved_at,approved_by_principal,
   marketplace_placement,public_evidence_reviewed,video_waiver_acknowledged,
   consent_recorded_at,consent_text_version,consent_media_manifest) values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   'profile-qa','FINALIZING',now(),'20000000-0000-0000-0000-000000000001',
   'TAILORING',true,true,now(),'v1',
   '["30000000-0000-0000-0000-000000000001","30000000-0000-0000-0000-000000000002"]');
insert into public.tailor_draft_media
  (id,invite_id,confirmed_at,moderation_status,media_kind,storage_path,content_type,
   byte_size,sha256,width,height,sort_order,is_cover,focal_x,focal_y,media_asset_id) values
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   now(),'APPROVED','AVATAR','private/avatar','image/jpeg',120,'hash',100,100,0,false,.5,.5,
   '40000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   now(),'APPROVED','PHOTO','private/old-photo','image/jpeg',120,'hash',100,100,1,true,.5,.5,
   '40000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
   now(),'BLOCKED','PHOTO','private/new-photo','image/jpeg',120,'hash',100,100,2,false,.5,.5,null);
insert into public.media_assets
  (id,bucket_id,object_path,owner_user_id,tailor_profile_id,metadata,status,
   availability_state,public_url,is_primary,portfolio_position,moderation_status) values
  ('40000000-0000-0000-0000-000000000001','avatars','claims/profile-qa/avatar.jpg',
   '00000000-0000-0000-0000-000000000001','profile-qa',
   '{"source":"TAILOR_CLAIM","draft_media_id":"30000000-0000-0000-0000-000000000001"}',
   'ACTIVE','AVAILABLE','https://example.invalid/avatar',false,null,'APPROVED'),
  ('40000000-0000-0000-0000-000000000002','portfolio-photos','claims/profile-qa/old-photo.jpg',
   '00000000-0000-0000-0000-000000000001','profile-qa',
   '{"source":"TAILOR_CLAIM","draft_media_id":"30000000-0000-0000-0000-000000000002"}',
   'ACTIVE','AVAILABLE','https://example.invalid/old-photo',true,1,'APPROVED');
insert into public.tailor_claim_finalize_receipts
  (id,invite_id,user_id,idempotency_key,outcome,source_manifest) values
  ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001','old-finalize-key-1234','IN_PROGRESS',
   '[{"id":"30000000-0000-0000-0000-000000000001","kind":"AVATAR"},
     {"id":"30000000-0000-0000-0000-000000000002","kind":"PHOTO"}]');

do $$
declare v_state text; v_result record;
begin
  v_state:=public.begin_tailor_profile_finalize_failure(
    '50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
    'FINALIZE_MEDIA_CHANGED');
  if v_state<>'CLEANING' then raise exception 'Failure did not begin cleanup'; end if;
  begin
    perform public.complete_tailor_profile_finalize(
      '50000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001','[]'::jsonb);
    raise exception 'Concurrent complete crossed CLEANING state';
  exception when sqlstate 'P1105' then null;
  end;
  if not public.finish_tailor_profile_finalize_failure(
    '50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001') then
    raise exception 'Failure did not reset';
  end if;
  if not public.finish_tailor_profile_finalize_failure(
    '50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001') then
    raise exception 'Failure replay was not idempotent';
  end if;
  if not exists(select 1 from public.tailor_claim_finalize_receipts
    where id='50000000-0000-0000-0000-000000000001' and outcome='FAILED'
      and failure_code='FINALIZE_MEDIA_CHANGED') then raise exception 'Receipt did not fail'; end if;
  if exists(select 1 from public.media_assets where status='ACTIVE' or public_url is not null)
    then raise exception 'Promoted assets remained active'; end if;
  if exists(select 1 from public.tailor_draft_media where media_asset_id is not null)
    then raise exception 'Draft media still points at public assets'; end if;
  if (select status from public.tailor_claim_invites where id='10000000-0000-0000-0000-000000000001')
      <>'CLAIMED_AWAITING_EMAIL' then raise exception 'Invite did not reset'; end if;
  if (select lifecycle_state from public.tailor_profiles where id='profile-qa')
      <>'CLAIMED_AWAITING_EMAIL' then raise exception 'Profile did not reset'; end if;
end;
$$;

update public.tailor_draft_media set moderation_status='BLOCKED'
  where id='30000000-0000-0000-0000-000000000002';
update public.tailor_draft_media set moderation_status='APPROVED'
  where id='30000000-0000-0000-0000-000000000003';
update public.tailor_claim_invites
  set consent_media_manifest='["30000000-0000-0000-0000-000000000001","30000000-0000-0000-0000-000000000003"]'
  where id='10000000-0000-0000-0000-000000000001';
do $$
declare v_result record;
begin
  select * into v_result from public.prepare_tailor_profile_finalize(
    '00000000-0000-0000-0000-000000000001','new-finalize-key-1234');
  if v_result.result<>'PREPARED' then raise exception 'Retry not prepared: %',v_result.result; end if;
  if v_result.source_manifest::text like '%30000000-0000-0000-0000-000000000002%'
     or v_result.source_manifest::text not like '%30000000-0000-0000-0000-000000000003%' then
    raise exception 'Retry reused frozen media manifest';
  end if;
  if not exists(select 1 from public.tailor_claim_finalize_receipts
    where id='50000000-0000-0000-0000-000000000001'
      and outcome='IN_PROGRESS' and idempotency_key='new-finalize-key-1234') then
    raise exception 'Receipt not reset for retry';
  end if;
end;
$$;
select 'tailor_claim_finalize_failure_recovery_passed' as result;
