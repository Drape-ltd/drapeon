-- Production-forward tailor-draft foundation.
--
-- This is intentionally self-contained. It replaces the Development-only
-- history for this feature and targets Production's UUID tailor_profiles.id.
-- It creates no public drafts and makes no data backfill.

alter table public.tailor_profiles
  add column if not exists lifecycle_state text not null default 'LIVE';

alter table public.tailor_profiles drop constraint if exists tailor_profiles_lifecycle_state_check;
alter table public.tailor_profiles add constraint tailor_profiles_lifecycle_state_check check (
  lifecycle_state in ('DRAFT','INVITED','OPENED','CLAIMING','CLAIMED_AWAITING_EMAIL','FINALIZING','LIVE','EXPIRED','REVOKED','DECLINED','SUSPENDED')
);

-- Existing profiles predate draft lifecycle and retain their existing visibility.
update public.tailor_profiles set lifecycle_state = 'LIVE' where lifecycle_state is null;
create index if not exists tailor_profiles_lifecycle_state_idx
  on public.tailor_profiles (lifecycle_state, updated_at desc);

drop index if exists public.tailor_profiles_public_marketplace_idx;
create index tailor_profiles_public_marketplace_idx
  on public.tailor_profiles (ranking_score desc nulls last, avg_rating desc nulls last)
  where is_live = true and is_verified = true and is_test_profile = false and lifecycle_state = 'LIVE';

drop policy if exists "Public can view live tailor profiles" on public.tailor_profiles;
create policy "Public can view live tailor profiles" on public.tailor_profiles for select using (
  is_live = true and is_verified = true and is_test_profile = false and lifecycle_state = 'LIVE'
);

create table if not exists public.tailor_claim_invites (
  id uuid primary key default gen_random_uuid(),
  tailor_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text unique,
  status text not null default 'DRAFT' check (status in ('DRAFT','INVITED','OPENED','CLAIMING','CLAIMED_AWAITING_EMAIL','FINALIZING','CLAIMED','LIVE','EXPIRED','REVOKED','DECLINED')),
  expires_at timestamptz,
  created_by_principal uuid not null references public.ops_workforce_principals(id) on delete restrict,
  source_handle text,
  source_url text,
  approved_by_principal uuid references public.ops_workforce_principals(id) on delete restrict,
  approval_reason text,
  evidence_ref text,
  public_evidence_reviewed boolean not null default false,
  video_waiver_acknowledged boolean not null default false,
  marketplace_placement text check (marketplace_placement in ('TAILORING','READY_TO_WEAR')),
  approved_at timestamptz,
  opened_at timestamptz,
  claimed_at timestamptz,
  revoked_at timestamptz,
  declined_at timestamptz,
  consent_recorded_at timestamptz,
  consent_text_version text,
  consent_media_manifest jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Production/fresh databases use uuid; the long-lived development project is
-- known to retain the legacy text id. Match the referenced parent type so this
-- migration applies cleanly without weakening the foreign key in either shape.
do $$ declare v_type text; begin
  select format_type(a.atttypid,a.atttypmod) into v_type
  from pg_attribute a where a.attrelid='public.tailor_profiles'::regclass and a.attname='id' and not a.attisdropped;
  if v_type not in ('uuid','text') then raise exception 'Unsupported tailor_profiles.id type: %',v_type; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tailor_claim_invites' and column_name='tailor_profile_id') then
    execute format('alter table public.tailor_claim_invites add column tailor_profile_id %s not null references public.tailor_profiles(id) on delete cascade',v_type);
  end if;
end $$;
create unique index if not exists tailor_claim_invites_profile_uidx on public.tailor_claim_invites(tailor_profile_id);

create unique index if not exists tailor_claim_invites_one_active_token_idx
  on public.tailor_claim_invites (tailor_profile_id)
  where token_hash is not null and status in ('INVITED','OPENED');
create index if not exists tailor_claim_invites_purge_idx
  on public.tailor_claim_invites (status, expires_at);

create table if not exists public.tailor_draft_media (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.tailor_claim_invites(id) on delete cascade,
  storage_path text not null unique,
  media_kind text not null check (media_kind in ('AVATAR','PHOTO','VIDEO')),
  content_type text not null,
  byte_size bigint not null check (byte_size between 1 and 52428800),
  sha256 text not null,
  width integer check (width between 1 and 12000),
  height integer check (height between 1 and 12000),
  duration_ms integer check (duration_ms between 1 and 300000),
  media_asset_id uuid references public.media_assets(id) on delete set null,
  confirmed_at timestamptz,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  focal_x numeric check (focal_x between 0 and 1),
  focal_y numeric check (focal_y between 0 and 1),
  moderation_status text not null default 'PENDING' check (moderation_status in ('PENDING','APPROVED','BLOCKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tailor_draft_media_invite_order_idx
  on public.tailor_draft_media (invite_id, sort_order, created_at);

create table if not exists public.tailor_draft_action_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_principal_id uuid not null references public.ops_workforce_principals(id) on delete restrict,
  action_key text not null,
  idempotency_key text not null,
  outcome text not null default 'IN_PROGRESS' check (outcome in ('IN_PROGRESS','SUCCEEDED','FAILED')),
  response jsonb,
  http_status integer check (http_status between 200 and 599),
  failure_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_principal_id, idempotency_key)
);

alter table public.tailor_claim_invites enable row level security;
alter table public.tailor_draft_media enable row level security;
alter table public.tailor_draft_action_receipts enable row level security;
revoke all on public.tailor_claim_invites, public.tailor_draft_media, public.tailor_draft_action_receipts from public, anon, authenticated;
grant all on public.tailor_claim_invites, public.tailor_draft_media, public.tailor_draft_action_receipts to service_role;

create or replace function public.resolve_tailor_claim_preview(p_token_hash text)
returns table(invite_id uuid, profile_id text, opened_now boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invite public.tailor_claim_invites%rowtype;
begin
  select * into v_invite from public.tailor_claim_invites
  where token_hash=p_token_hash for update;
  if not found or v_invite.status not in ('INVITED','OPENED') then return; end if;
  if v_invite.expires_at is null or v_invite.expires_at<=now() then
    update public.tailor_claim_invites set status='EXPIRED',token_hash=null,updated_at=now() where id=v_invite.id;
    update public.tailor_profiles set lifecycle_state='EXPIRED',updated_at=now() where id=v_invite.tailor_profile_id and lifecycle_state in ('INVITED','OPENED');
    return;
  end if;
  opened_now:=v_invite.status='INVITED';
  if opened_now then
    update public.tailor_claim_invites set status='OPENED',opened_at=coalesce(opened_at,now()),updated_at=now() where id=v_invite.id;
    update public.tailor_profiles set lifecycle_state='OPENED',updated_at=now() where id=v_invite.tailor_profile_id and lifecycle_state='INVITED';
  end if;
  invite_id:=v_invite.id;profile_id:=v_invite.tailor_profile_id::text;return next;
end;
$$;
revoke all on function public.resolve_tailor_claim_preview(text) from public,anon,authenticated;
grant execute on function public.resolve_tailor_claim_preview(text) to service_role;

create or replace function public.update_tailor_draft_media_layout(
  p_invite_id uuid,p_asset_id uuid,p_sort_order integer,p_is_cover boolean,p_focal_x numeric,p_focal_y numeric
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.tailor_claim_invites where id=p_invite_id and status in ('DRAFT','INVITED','OPENED') for update;
  if not found then return false; end if;
  perform 1 from public.tailor_draft_media where id=p_asset_id and invite_id=p_invite_id for update;
  if not found then return false; end if;
  if p_is_cover then update public.tailor_draft_media set is_cover=false,updated_at=now() where invite_id=p_invite_id and is_cover; end if;
  update public.tailor_draft_media set sort_order=p_sort_order,is_cover=p_is_cover,focal_x=p_focal_x,focal_y=p_focal_y,updated_at=now()
  where id=p_asset_id and invite_id=p_invite_id;
  return true;
end;$$;
revoke all on function public.update_tailor_draft_media_layout(uuid,uuid,integer,boolean,numeric,numeric) from public,anon,authenticated;
grant execute on function public.update_tailor_draft_media_layout(uuid,uuid,integer,boolean,numeric,numeric) to service_role;

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
    -- Canonical profile prices are minor units (kobo/cents/pesewas).
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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tailor-draft-media', 'tailor-draft-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "tailor-draft-media: service only" on storage.objects;
-- No anon/authenticated storage policy is intentional. Service role bypasses RLS.

create or replace function public.guard_tailor_draft_visibility()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.lifecycle_state <> 'LIVE' and (new.is_live or new.is_verified) then
    raise exception 'Draft lifecycle profiles cannot be public or verified';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_tailor_draft_visibility on public.tailor_profiles;
create trigger trg_guard_tailor_draft_visibility before insert or update of lifecycle_state,is_live,is_verified
on public.tailor_profiles for each row execute function public.guard_tailor_draft_visibility();

revoke all on function public.guard_tailor_draft_visibility() from public,anon,authenticated;
grant execute on function public.guard_tailor_draft_visibility() to service_role;

-- Production's portfolio and seller policies already call
-- is_public_tailor_profile(text). Replacing that UUID/text-safe helper above
-- adds lifecycle gating without renaming or broadening any existing policy.

comment on table public.tailor_claim_invites is 'Service-only hashed claim capability and staff pre-approval snapshot.';
comment on table public.tailor_draft_media is 'Private pre-claim media manifest; paths are never returned by public preview APIs.';
comment on table public.tailor_draft_action_receipts is 'Service-only durable replay receipts for staff draft mutations.';

-- Production already uses these UUID/text-safe boolean helpers for public
-- catalogue policies. Keep that established model and add lifecycle gating in
-- the helper so every dependent policy fails closed before a claim is LIVE.
create or replace function public.is_public_tailor_profile(p_tailor_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tailor_profiles tp
    where tp.id::text = p_tailor_profile_id
      and tp.is_live
      and tp.is_verified
      and not tp.is_test_profile
      and tp.lifecycle_state = 'LIVE'
  )
$$;
revoke all on function public.is_public_tailor_profile(text) from public;
grant execute on function public.is_public_tailor_profile(text) to anon, authenticated;

-- Final draft-media semantics: exactly one confirmed avatar, a transactional
-- move-style reorder, and minor-unit prices in the shared profile columns.
create or replace function public.enforce_one_tailor_draft_avatar()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.media_kind='AVATAR' and new.confirmed_at is not null then
    if exists(select 1 from public.tailor_draft_media
      where invite_id=new.invite_id and media_kind='AVATAR' and confirmed_at is not null and id<>new.id) then
      raise exception 'Only one confirmed draft avatar is allowed';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_one_tailor_draft_avatar on public.tailor_draft_media;
create trigger trg_one_tailor_draft_avatar before insert or update of invite_id,media_kind,confirmed_at
on public.tailor_draft_media for each row execute function public.enforce_one_tailor_draft_avatar();
revoke all on function public.enforce_one_tailor_draft_avatar() from public,anon,authenticated;
grant execute on function public.enforce_one_tailor_draft_avatar() to service_role;

create or replace function public.reorder_tailor_draft_media(p_invite_id uuid,p_asset_ids uuid[])
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_expected integer; v_actual integer;
begin
  perform 1 from public.tailor_claim_invites where id=p_invite_id and status in ('DRAFT','INVITED','OPENED') for update;
  if not found or p_asset_ids is null or cardinality(p_asset_ids) is null then return false; end if;
  select count(*) into v_expected from public.tailor_draft_media
    where invite_id=p_invite_id and confirmed_at is not null;
  select count(*) into v_actual from unnest(p_asset_ids) as id;
  if v_expected<>v_actual or v_actual<>(select count(distinct id) from unnest(p_asset_ids) as id)
     or exists(select 1 from unnest(p_asset_ids) as id left join public.tailor_draft_media m on m.id=id and m.invite_id=p_invite_id and m.confirmed_at is not null where m.id is null) then
    return false;
  end if;
  update public.tailor_draft_media set sort_order = -1000000 - sort_order where invite_id=p_invite_id and confirmed_at is not null;
  update public.tailor_draft_media m set sort_order=o.ordinality-1,updated_at=now()
    from unnest(p_asset_ids) with ordinality as o(id, ordinality) where m.id=o.id;
  return true;
end;
$$;
revoke all on function public.reorder_tailor_draft_media(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_tailor_draft_media(uuid,uuid[]) to service_role;
-- Forward-only repair for Development and fresh installs. The original PR 1
-- migration was exercised in Development before these rules existed.

create or replace function public.update_tailor_draft_media_layout(
  p_invite_id uuid,p_asset_id uuid,p_sort_order integer,p_is_cover boolean,p_focal_x numeric,p_focal_y numeric
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.tailor_claim_invites where id=p_invite_id and status='DRAFT' for update;
  if not found then return false; end if;
  perform 1 from public.tailor_draft_media where id=p_asset_id and invite_id=p_invite_id and confirmed_at is not null for update;
  if not found then return false; end if;
  if p_is_cover then update public.tailor_draft_media set is_cover=false,updated_at=now() where invite_id=p_invite_id and is_cover; end if;
  update public.tailor_draft_media set sort_order=p_sort_order,is_cover=p_is_cover,focal_x=p_focal_x,focal_y=p_focal_y,updated_at=now()
  where id=p_asset_id and invite_id=p_invite_id;
  return true;
end;$$;
revoke all on function public.update_tailor_draft_media_layout(uuid,uuid,integer,boolean,numeric,numeric) from public,anon,authenticated;
grant execute on function public.update_tailor_draft_media_layout(uuid,uuid,integer,boolean,numeric,numeric) to service_role;

create or replace function public.reorder_tailor_draft_media(
  p_invite_id uuid,p_asset_ids uuid[]
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_supplied integer:=coalesce(array_length(p_asset_ids,1),0);
begin
  perform 1 from public.tailor_claim_invites where id=p_invite_id and status='DRAFT' for update;
  if not found then return false; end if;

  if v_supplied=0
    or (select count(distinct value) from unnest(p_asset_ids) as input(value))<>v_supplied
    or exists(select 1 from unnest(p_asset_ids) as input(value) where not exists(
      select 1 from public.tailor_draft_media media
      where media.id=input.value and media.invite_id=p_invite_id and media.confirmed_at is not null
    )) then return false;
  end if;

  update public.tailor_draft_media media
  set sort_order=ordered.ordinality-1,updated_at=now()
  from unnest(p_asset_ids) with ordinality ordered(asset_id,ordinality)
  where media.id=ordered.asset_id and media.invite_id=p_invite_id and media.confirmed_at is not null;

  -- Append any confirmed rows that an older client cannot display (for example,
  -- a legacy duplicate avatar). Incomplete uploads remain outside the order.
  with remaining as (
    select id,row_number() over(order by sort_order,id) as position
    from public.tailor_draft_media
    where invite_id=p_invite_id and confirmed_at is not null and not (id=any(p_asset_ids))
  )
  update public.tailor_draft_media media
  set sort_order=v_supplied+remaining.position-1,updated_at=now()
  from remaining where media.id=remaining.id;
  return true;
end;$$;
revoke all on function public.reorder_tailor_draft_media(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_tailor_draft_media(uuid,uuid[]) to service_role;

create or replace function public.enforce_one_tailor_draft_avatar()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.media_kind='AVATAR' then
    perform 1 from public.tailor_claim_invites where id=new.invite_id for update;
  end if;
  if new.media_kind='AVATAR' and exists(
    select 1 from public.tailor_draft_media
    where invite_id=new.invite_id and media_kind='AVATAR' and id<>new.id
  ) then raise exception using errcode='23505',message='A draft can have only one avatar.';
  end if;
  return new;
end;$$;
drop trigger if exists trg_one_tailor_draft_avatar on public.tailor_draft_media;
create trigger trg_one_tailor_draft_avatar before insert or update of invite_id,media_kind
on public.tailor_draft_media for each row execute function public.enforce_one_tailor_draft_avatar();
revoke all on function public.enforce_one_tailor_draft_avatar() from public,anon,authenticated;
grant execute on function public.enforce_one_tailor_draft_avatar() to service_role;
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
