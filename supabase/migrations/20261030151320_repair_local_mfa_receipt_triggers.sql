-- The original Dev MFA migration reused one trigger function across grants and
-- requests. PostgreSQL resolves NEW/OLD fields for the active trigger relation,
-- so referencing both tables' columns in one function breaks every update on
-- both tables. Keep each immutable receipt guard relation-specific.

create or replace function public.protect_local_mfa_grant_receipt_fn()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.workforce_principal_id is distinct from old.workforce_principal_id
    or new.auth_user_id is distinct from old.auth_user_id
    or new.aal is distinct from old.aal
    or new.mfa_authenticated_at is distinct from old.mfa_authenticated_at
    or new.assurance_source is distinct from old.assurance_source then
    raise exception 'Money Desk MFA identity receipt is immutable.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_local_mfa_request_receipt_fn()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.requester_principal_id is distinct from old.requester_principal_id
    or new.requester_auth_user_id is distinct from old.requester_auth_user_id
    or new.requester_aal is distinct from old.requester_aal
    or new.requester_mfa_at is distinct from old.requester_mfa_at
    or new.requester_assurance_source is distinct from old.requester_assurance_source then
    raise exception 'Money Desk requester identity receipt is immutable.';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_local_mfa_grant_receipt_fn() from public, anon, authenticated, service_role;
revoke all on function public.protect_local_mfa_request_receipt_fn() from public, anon, authenticated, service_role;

drop trigger if exists protect_local_mfa_grant_receipt on public.money_desk_jit_grants;
create trigger protect_local_mfa_grant_receipt
before update on public.money_desk_jit_grants
for each row execute function public.protect_local_mfa_grant_receipt_fn();

drop trigger if exists protect_local_mfa_request_receipt on public.money_desk_requests;
create trigger protect_local_mfa_request_receipt
before update on public.money_desk_requests
for each row execute function public.protect_local_mfa_request_receipt_fn();

drop function if exists public.protect_local_mfa_identity_receipt();
