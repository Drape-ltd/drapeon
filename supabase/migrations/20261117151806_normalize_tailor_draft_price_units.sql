-- Canonical tailor profile prices are stored in minor units (cents, kobo,
-- pesewas). PR 1 initially wrote staff-entered major units into the same
-- columns. Normalize every profile owned by a claim invite exactly once.
update public.tailor_profiles profile
set price_range_min=profile.price_range_min*100,
    price_range_max=profile.price_range_max*100,
    updated_at=now()
from public.tailor_claim_invites invite
where invite.tailor_profile_id=profile.id
  and profile.price_range_min is not null
  and profile.price_range_max is not null;

create or replace function public.transition_tailor_claim_invite(
  p_invite_id uuid,
  p_action text,
  p_token_hash text default null,
  p_expires_at timestamptz default null
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_next text;
  v_currency_min integer;
  v_currency_max integer;
begin
  select * into v_invite from public.tailor_claim_invites where id=p_invite_id for update;
  if not found then return false; end if;
  select * into v_profile from public.tailor_profiles where id=v_invite.tailor_profile_id for update;
  if not found then return false; end if;

  if p_action='ISSUE' then
    if v_invite.status not in ('DRAFT','INVITED','OPENED','REVOKED','EXPIRED')
      or p_token_hash is null or p_expires_at is null or p_expires_at<=now()
      or v_invite.approved_at is null or v_invite.approved_by_principal is null
      or v_invite.marketplace_placement is null or not v_invite.public_evidence_reviewed
      or not v_invite.video_waiver_acknowledged then return false; end if;
    v_currency_min:=case v_profile.currency when 'NGN' then 500000 when 'GHS' then 5000 when 'KES' then 50000 else 1000 end;
    v_currency_max:=case v_profile.currency when 'NGN' then 999999900 when 'GHS' then 100000000 when 'KES' then 500000000 when 'USD' then 10000000 when 'GBP' then 10000000 when 'EUR' then 10000000 when 'CAD' then 10000000 else null end;
    if length(trim(v_profile.display_name))<2 or length(trim(v_profile.location))<1
      or length(trim(coalesce(v_profile.bio,'')))<80
      or coalesce(cardinality(v_profile.languages),0) not between 1 and 12
      or coalesce(cardinality(v_profile.specialty_tags),0) not between 1 and 20
      or v_currency_max is null or v_profile.price_range_min is null or v_profile.price_range_max is null or v_profile.price_range_min<v_currency_min
      or v_profile.price_range_max<v_profile.price_range_min or v_profile.price_range_max>v_currency_max
      or not exists (select 1 from public.tailor_draft_media where invite_id=p_invite_id and media_kind='AVATAR' and moderation_status='APPROVED' and confirmed_at is not null)
      or not exists (select 1 from public.tailor_draft_media where invite_id=p_invite_id and media_kind='PHOTO' and moderation_status='APPROVED' and confirmed_at is not null)
    then return false; end if;
    update public.tailor_claim_invites set token_hash=p_token_hash,status='INVITED',expires_at=p_expires_at,revoked_at=null,declined_at=null,updated_at=now() where id=p_invite_id;
    update public.tailor_profiles set lifecycle_state='INVITED',updated_at=now() where id=v_invite.tailor_profile_id;
    return true;
  end if;

  if p_action not in ('REVOKE','DECLINE') or v_invite.status not in ('DRAFT','INVITED','OPENED') then return false; end if;
  v_next:=case p_action when 'REVOKE' then 'REVOKED' else 'DECLINED' end;
  update public.tailor_claim_invites set status=v_next,token_hash=null,
    revoked_at=case when p_action='REVOKE' then now() else revoked_at end,
    declined_at=case when p_action='DECLINE' then now() else declined_at end,updated_at=now()
  where id=p_invite_id;
  update public.tailor_profiles set lifecycle_state=v_next,updated_at=now() where id=v_invite.tailor_profile_id;
  return true;
end;$$;
revoke all on function public.transition_tailor_claim_invite(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.transition_tailor_claim_invite(uuid,text,text,timestamptz) to service_role;

-- An interrupted, unconfirmed avatar upload must not reserve the avatar slot.
create or replace function public.enforce_one_tailor_draft_avatar()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.media_kind='AVATAR' and new.confirmed_at is not null then
    perform 1 from public.tailor_claim_invites where id=new.invite_id for update;
  end if;
  if new.media_kind='AVATAR' and new.confirmed_at is not null and exists(
    select 1 from public.tailor_draft_media
    where invite_id=new.invite_id and media_kind='AVATAR' and confirmed_at is not null and id<>new.id
  ) then raise exception using errcode='23505',message='A draft can have only one confirmed avatar.';
  end if;
  return new;
end;$$;
drop trigger if exists trg_one_tailor_draft_avatar on public.tailor_draft_media;
create trigger trg_one_tailor_draft_avatar before insert or update of invite_id,media_kind,confirmed_at
on public.tailor_draft_media for each row execute function public.enforce_one_tailor_draft_avatar();
revoke all on function public.enforce_one_tailor_draft_avatar() from public,anon,authenticated;
grant execute on function public.enforce_one_tailor_draft_avatar() to service_role;
