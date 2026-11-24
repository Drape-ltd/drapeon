do $$
begin
  if exists (select 1 from public.bachs_account_setup_claims where state = 'REJECTED') then
    raise exception 'Cannot roll back while definite Bachs account-setup rejections exist';
  end if;
end;
$$;

drop function if exists public.record_bachs_account_setup_definite_rejection(uuid, integer, text);
alter table public.bachs_account_setup_claims
  drop constraint if exists bachs_account_setup_claims_check,
  drop constraint if exists bachs_account_setup_claims_state_check;
alter table public.bachs_account_setup_claims
  add constraint bachs_account_setup_claims_state_check
    check (state in ('RESERVED', 'BOUND', 'REVIEW')),
  add constraint bachs_account_setup_claims_check
    check (
      (state = 'RESERVED' and provider_account_ref is null)
      or (state in ('BOUND', 'REVIEW') and provider_account_ref is not null)
    );
alter table public.bachs_account_setup_claims
  drop column if exists provider_rejection_status,
  drop column if exists provider_rejection_code,
  drop column if exists provider_rejected_at;
