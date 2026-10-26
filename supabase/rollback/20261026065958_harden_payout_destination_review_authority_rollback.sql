-- Restore the pre-hardening review behavior. Use only when the review workflow
-- migration is also being rolled back; otherwise the audited RPC will fail closed.
grant insert on public.payout_destination_review_events to service_role;

create or replace function private.guard_payout_destination_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_review_actor_id uuid;
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
    if new.capability_checked_at is null then
      raise exception using errcode = '23514', constraint = 'payout_destination_capability_check_required',
        message = 'Destination capability and first-withdrawal state require provider evidence';
    end if;
    if new.capability_checked_at is not distinct from old.capability_checked_at
      and not (
        v_review_actor_id is not null
        and old.first_withdrawal_review_status = 'PENDING'
        and new.first_withdrawal_review_status in ('CLEARED', 'BLOCKED')
        and new.transfers_enabled is not distinct from old.transfers_enabled
        and new.payouts_enabled is not distinct from old.payouts_enabled
      ) then
      raise exception using errcode = '23514', constraint = 'payout_destination_capability_check_required',
        message = 'Capability changes require a fresh provider check; a review decision requires the audited review function';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$function$;

revoke insert on public.payout_destination_review_events from public, anon, authenticated, service_role;
grant select, insert on public.payout_destination_review_events to service_role;
