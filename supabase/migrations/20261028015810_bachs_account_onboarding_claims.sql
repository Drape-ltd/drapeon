-- Idempotent, fail-closed reservation for Bachs recipient account creation.
-- An uncertain provider write stays reserved until Ops reconciles it; it is
-- never retried as a second account-creation operation.
create table if not exists public.bachs_account_setup_claims (
  id uuid primary key default gen_random_uuid(),
  tailor_profile_id text not null,
  route_id uuid not null,
  route_version integer not null,
  provider_request_key text not null unique,
  provider_account_ref text,
  state text not null default 'RESERVED' check (state in ('RESERVED', 'BOUND', 'REVIEW')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tailor_profile_id, route_id, route_version),
  foreign key (route_id, route_version) references public.payment_routes(id, version) on delete restrict,
  check (
    (state = 'RESERVED' and provider_account_ref is null)
    or (state in ('BOUND', 'REVIEW') and provider_account_ref is not null)
  )
);

create unique index if not exists bachs_account_setup_claims_account_ref_uidx
  on public.bachs_account_setup_claims (provider_account_ref)
  where provider_account_ref is not null;

alter table public.bachs_account_setup_claims enable row level security;
revoke all on public.bachs_account_setup_claims from public, anon, authenticated;
grant select, insert, update on public.bachs_account_setup_claims to service_role;

create or replace function public.reserve_bachs_account_setup(
  p_tailor_profile_id text,
  p_route_id uuid,
  p_route_version integer
)
returns table (
  claim_id uuid,
  provider_request_key text,
  provider_account_ref text,
  state text,
  may_create boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_claim public.bachs_account_setup_claims%rowtype;
  v_created boolean := false;
begin
  if nullif(trim(p_tailor_profile_id), '') is null or p_route_id is null or p_route_version < 1 then
    raise exception 'invalid Bachs account setup identity';
  end if;
  v_key := 'drapeon-bachs-account:' || p_tailor_profile_id || ':' || p_route_id::text || ':' || p_route_version::text;

  insert into public.bachs_account_setup_claims (
    tailor_profile_id, route_id, route_version, provider_request_key
  ) values (p_tailor_profile_id, p_route_id, p_route_version, v_key)
  on conflict (tailor_profile_id, route_id, route_version) do nothing
  returning * into v_claim;
  v_created := found;
  if not v_created then
    select * into v_claim from public.bachs_account_setup_claims as claim
    where claim.tailor_profile_id = p_tailor_profile_id
      and claim.route_id = p_route_id
      and claim.route_version = p_route_version;
    if not found then raise exception 'Bachs account setup reservation conflicted'; end if;
  end if;
  return query select v_claim.id, v_claim.provider_request_key, v_claim.provider_account_ref, v_claim.state, v_created;
end;
$$;

revoke all on function public.reserve_bachs_account_setup(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_bachs_account_setup(text, uuid, integer) to service_role;

create or replace function public.bind_bachs_account_setup(
  p_claim_id uuid,
  p_provider_account_ref text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.bachs_account_setup_claims%rowtype;
begin
  if p_claim_id is null or p_provider_account_ref is null or p_provider_account_ref !~ '^acct_[A-Za-z0-9_-]+$' then
    return false;
  end if;

  select * into v_claim from public.bachs_account_setup_claims
  where id = p_claim_id for update;
  if not found then return false; end if;
  if v_claim.provider_account_ref is not null then
    return v_claim.provider_account_ref = p_provider_account_ref;
  end if;
  if v_claim.state <> 'RESERVED' then return false; end if;

  update public.bachs_account_setup_claims
  set provider_account_ref = p_provider_account_ref, state = 'BOUND', updated_at = now()
  where id = p_claim_id and provider_account_ref is null and state = 'RESERVED';
  return found;
exception when unique_violation then
  return false;
end;
$$;

revoke all on function public.bind_bachs_account_setup(uuid, text) from public, anon, authenticated;
grant execute on function public.bind_bachs_account_setup(uuid, text) to service_role;
