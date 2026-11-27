create schema auth;
create role service_role;
create role anon;
create role authenticated;
create table auth.users (id uuid primary key,email text,email_confirmed_at timestamptz);
create table public.users (id uuid primary key,phone_verified_at timestamptz);
create table public.tailor_profiles (
  id text primary key,lifecycle_state text,currency text,display_name text,location text,bio text,
  languages text[],specialty_tags text[],price_range_min integer,price_range_max integer,
  avatar_url text,portfolio_photo_urls text[],portfolio_video_urls text[],
  id_verification_status text,id_verified_at timestamptz,id_verification_method text,
  id_verification_metadata jsonb,is_verified boolean,is_live boolean,updated_at timestamptz
);
create table public.tailor_claim_invites (
  id uuid primary key,tailor_user_id uuid,tailor_profile_id text,status text,updated_at timestamptz,
  approved_at timestamptz,approved_by_principal uuid,marketplace_placement text,
  public_evidence_reviewed boolean,video_waiver_acknowledged boolean,
  consent_recorded_at timestamptz,consent_text_version text,consent_media_manifest jsonb,
  approval_reason text,evidence_ref text
);
create table public.tailor_draft_media (
  id uuid primary key,invite_id uuid,confirmed_at timestamptz,moderation_status text,
  media_kind text,storage_path text,content_type text,byte_size integer,sha256 text,
  width integer,height integer,duration_ms integer,sort_order integer,is_cover boolean,
  focal_x numeric,focal_y numeric,media_asset_id uuid,created_at timestamptz default now(),updated_at timestamptz
);
create table public.media_assets (
  id uuid primary key,bucket_id text,object_path text,owner_user_id uuid,tailor_profile_id text,
  metadata jsonb,status text,availability_state text,public_url text,is_primary boolean,
  portfolio_position integer,moderation_status text,updated_at timestamptz
);
create table public.audit_logs (actor_id text,actor_role text,event text,severity text,payload jsonb);
create table public.tailor_claim_finalize_receipts (
  id uuid primary key,invite_id uuid,user_id uuid,idempotency_key text,
  outcome text not null,source_manifest jsonb not null,response_payload jsonb,
  failure_code text,created_at timestamptz default now(),completed_at timestamptz,
  constraint tailor_claim_finalize_receipts_outcome_check
    check (outcome in ('IN_PROGRESS','SUCCEEDED','FAILED')),
  constraint tailor_claim_finalize_receipts_check
    check ((outcome='IN_PROGRESS')=(completed_at is null)),
  unique(invite_id),unique(user_id,idempotency_key)
);
