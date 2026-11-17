-- Development-only PR 1 foundation for staff-built tailor drafts.
-- Do not promote this migration to production before the feature PR is reviewed.

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
  tailor_profile_id text not null references public.tailor_profiles(id) on delete cascade,
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
  updated_at timestamptz not null default now(),
  unique (tailor_profile_id)
);

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
  invite_id:=v_invite.id;profile_id:=v_invite.tailor_profile_id;return next;
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

-- Public portfolio and seller records also fail closed if a profile is ever
-- accidentally marked live before its lifecycle reaches LIVE.
drop policy if exists "Public views portfolio of live tailors" on public.portfolio_photos;
create policy "Public views portfolio of live tailors" on public.portfolio_photos for select using (
  exists (select 1 from public.tailor_profiles tp where tp.id=portfolio_photos.tailor_profile_id
    and tp.is_live and tp.is_verified and not tp.is_test_profile and tp.lifecycle_state='LIVE')
);
drop policy if exists "public: view live portfolio" on public.portfolio_items;
create policy "public: view live portfolio" on public.portfolio_items for select to anon,authenticated using (
  exists (select 1 from public.tailor_profiles tp where tp.id=portfolio_items.tailor_profile_id
    and tp.is_live and tp.is_verified and not tp.is_test_profile and tp.lifecycle_state='LIVE')
);
drop policy if exists "public reads live seller items" on public.seller_items;
create policy "public reads live seller items" on public.seller_items for select using (
  is_live and exists (select 1 from public.tailor_profiles tp where tp.id=seller_items.tailor_profile_id
    and tp.is_live and tp.is_verified and not tp.is_test_profile and tp.lifecycle_state='LIVE')
);

comment on table public.tailor_claim_invites is 'Service-only hashed claim capability and staff pre-approval snapshot.';
comment on table public.tailor_draft_media is 'Private pre-claim media manifest; paths are never returned by public preview APIs.';
comment on table public.tailor_draft_action_receipts is 'Service-only durable replay receipts for staff draft mutations.';
