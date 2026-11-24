-- A definite provider 403 creates no connected account. Keep the claim and
-- request key as history, but make the reservation terminal without deleting
-- it or ever re-posting account creation.
alter table public.bachs_account_setup_claims
  add column if not exists provider_rejection_status integer,
  add column if not exists provider_rejection_code text,
  add column if not exists provider_rejected_at timestamptz;

alter table public.bachs_account_setup_claims
  drop constraint if exists bachs_account_setup_claims_state_check;
alter table public.bachs_account_setup_claims
  add constraint bachs_account_setup_claims_state_check
  check (state in ('RESERVED', 'BOUND', 'REVIEW', 'REJECTED'));

alter table public.bachs_account_setup_claims
  drop constraint if exists bachs_account_setup_claims_check;
alter table public.bachs_account_setup_claims
  add constraint bachs_account_setup_claims_check
  check (
    (state = 'RESERVED' and provider_account_ref is null
      and provider_rejection_status is null and provider_rejection_code is null
      and provider_rejected_at is null)
    or (state in ('BOUND', 'REVIEW') and provider_account_ref is not null
      and provider_rejection_status is null and provider_rejection_code is null
      and provider_rejected_at is null)
    or (state = 'REJECTED' and provider_account_ref is null
      and provider_rejection_status = 403
      and provider_rejection_code = 'FORBIDDEN'
      and provider_rejected_at is not null)
  );

create or replace function public.record_bachs_account_setup_definite_rejection(
  p_claim_id uuid,
  p_provider_status integer,
  p_provider_code text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_claim public.bachs_account_setup_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_claim_id is null or p_provider_status is distinct from 403
    or p_provider_code is distinct from 'FORBIDDEN' then
    raise exception 'Only a definite Bachs 403 FORBIDDEN may close this claim';
  end if;
  select * into v_claim from public.bachs_account_setup_claims
    where id = p_claim_id for update;
  if not found then return false; end if;
  if v_claim.state = 'REJECTED' then
    return v_claim.provider_rejection_status = 403
      and v_claim.provider_rejection_code = 'FORBIDDEN';
  end if;
  if v_claim.state <> 'RESERVED' or v_claim.provider_account_ref is not null then
    return false;
  end if;
  update public.bachs_account_setup_claims
    set state = 'REJECTED', provider_rejection_status = 403,
      provider_rejection_code = 'FORBIDDEN', provider_rejected_at = now(),
      updated_at = now()
    where id = p_claim_id and state = 'RESERVED'
      and provider_account_ref is null;
  return found;
end;
$$;

revoke all on function public.record_bachs_account_setup_definite_rejection(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_bachs_account_setup_definite_rejection(uuid, integer, text)
  to service_role;
