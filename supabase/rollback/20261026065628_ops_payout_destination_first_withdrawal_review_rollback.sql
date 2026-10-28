begin;

do $guard$
begin
  if exists (select 1 from public.payout_destination_review_events) then
    raise exception 'Cannot roll back first-withdrawal review while audit events exist.';
  end if;
end
$guard$;

drop function if exists public.ops_review_payout_destination_first_withdrawal(uuid, uuid, text, text, text);

-- Restore the destination guard from the route-foundation migration before
-- dropping the review table referenced by the newer guard.
create or replace function private.guard_payout_destination_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.tailor_profile_id is distinct from old.tailor_profile_id
    or new.provider is distinct from old.provider
    or new.legal_entity is distinct from old.legal_entity
    or new.country_code is distinct from old.country_code
    or new.currency is distinct from old.currency
    or new.provider_account_ref is distinct from old.provider_account_ref
    or new.fees_collector is distinct from old.fees_collector then
    raise exception using errcode = '23514', constraint = 'payout_destination_identity_immutable',
      message = 'Payout destination identity and fee collector are immutable';
  end if;
  if new.transfers_enabled is distinct from old.transfers_enabled
    or new.payouts_enabled is distinct from old.payouts_enabled
    or new.first_withdrawal_review_status is distinct from old.first_withdrawal_review_status
    or new.active is distinct from old.active then
    if new.capability_checked_at is null
      or new.capability_checked_at is not distinct from old.capability_checked_at then
      raise exception using errcode = '23514', constraint = 'payout_destination_capability_check_required',
        message = 'Destination capability and first-withdrawal state require a fresh check';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$function$;

drop table if exists public.payout_destination_review_events;

commit;
