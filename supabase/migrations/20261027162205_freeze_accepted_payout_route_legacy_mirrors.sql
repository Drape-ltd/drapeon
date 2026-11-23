-- Provider-neutral route snapshots are authoritative after quote acceptance.
-- Freeze the retained payment/payout mirrors as well so a later writer cannot
-- make checkout or payout consumers observe a different currency or payout
-- destination than the accepted route snapshot. payment_provider is deliberately
-- excluded: it is transient active-attempt state that expiry can clear; the
-- immutable charge_provider_snapshot remains the canonical route provider.

create or replace function private.guard_accepted_payout_route_legacy_mirrors()
returns trigger
language plpgsql
security invoker
as $function$
begin
  if old.accepted_route_snapshot_at is null and new.accepted_route_snapshot_at is not null then
    -- Provider-neutral destinations are read by destination ID. Do not copy a
    -- Bachs account reference into the legacy Stripe-only column.
    new.tailor_paystack_recipient_code_locked := null;
    if new.charge_provider_snapshot is distinct from 'STRIPE' then
      new.tailor_stripe_connect_account_id_locked := null;
    end if;
  end if;

  if old.accepted_route_snapshot_at is not null and (
    new.currency is distinct from old.currency
    or new.tailor_payout_currency_locked is distinct from old.tailor_payout_currency_locked
    or new.tailor_payout_provider_locked is distinct from old.tailor_payout_provider_locked
    or new.tailor_paystack_recipient_code_locked is distinct from old.tailor_paystack_recipient_code_locked
    or new.tailor_stripe_connect_account_id_locked is distinct from old.tailor_stripe_connect_account_id_locked
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'orders_accepted_payout_route_mirrors_immutable',
      message = 'Payout route mirrors cannot change after the accepted route snapshot is set';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_accepted_payout_route_legacy_mirrors() from public, anon, authenticated;
grant execute on function private.guard_accepted_payout_route_legacy_mirrors() to service_role;

create trigger orders_accepted_payout_route_mirrors_immutable
before update of
  accepted_route_snapshot_at,
  charge_provider_snapshot,
  currency,
  tailor_payout_currency_locked,
  tailor_payout_provider_locked,
  tailor_paystack_recipient_code_locked,
  tailor_stripe_connect_account_id_locked
on public.orders
for each row
execute function private.guard_accepted_payout_route_legacy_mirrors();
