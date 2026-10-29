-- Restore the exact Dev guards captured immediately before this migration.
CREATE OR REPLACE FUNCTION private.guard_accepted_payment_route_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_route public.payment_routes%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_delivery_rule public.delivery_country_rules%rowtype;
  v_environment text;
begin
  if new.accepted_route_snapshot_at is not null and (
    tg_op = 'INSERT' or old.accepted_route_snapshot_at is null
  ) then
    if coalesce(current_setting('app.payment_route_snapshot_write', true), '') <> 'on' then
      raise exception using
        errcode = '42501',
        constraint = 'orders_route_snapshot_backend_only',
        message = 'Accepted route snapshots must be written by the canonical acceptance operation';
    end if;

    select * into v_route
    from public.payment_routes as route
    where route.id = new.payment_route_id
      and route.version = new.payment_route_version;
    select * into v_destination
    from public.payout_destinations as destination
    where destination.id = new.payout_destination_id;
    select * into v_delivery_rule
    from public.delivery_country_rules as delivery_rule
    where delivery_rule.id = new.delivery_country_rule_id
      and delivery_rule.version = new.delivery_country_rule_version;
    v_environment := upper(coalesce(current_setting('app.payment_environment', true), ''));

    if v_route.id is null or v_destination.id is null or v_delivery_rule.id is null
      or v_route.status = 'DISABLED'
      or (v_route.status = 'SANDBOX_ONLY' and v_environment <> 'SANDBOX')
      or v_route.provider is distinct from new.charge_provider_snapshot
      or v_route.legal_entity is distinct from new.legal_entity_snapshot
      or v_route.charge_currency is distinct from new.charge_currency_snapshot
      or v_route.payout_currency is distinct from new.tailor_payout_currency_locked::text
      or new.currency::text is distinct from new.charge_currency_snapshot
      or v_route.fee_schedule_version is distinct from new.fee_schedule_version_snapshot
      or v_destination.provider is distinct from v_route.provider
      or v_destination.legal_entity is distinct from v_route.legal_entity
      or v_destination.country_code is distinct from v_route.tailor_country_code
      or v_destination.currency is distinct from v_route.payout_currency
      or v_destination.fees_collector is distinct from v_route.fees_collector
      or v_destination.tailor_profile_id::text is distinct from new.tailor_profile_id::text
      or not v_destination.active
      or not v_destination.transfers_enabled
      or not v_destination.payouts_enabled
      or v_destination.first_withdrawal_review_status <> 'CLEARED'
      or v_delivery_rule.status <> 'READY'
      or v_delivery_rule.country_code is distinct from upper(coalesce(new.delivery_country_code, '')) then
      raise exception using
        errcode = '23514',
        constraint = 'orders_route_snapshot_matches_ready_configuration',
        message = 'Accepted route snapshot does not match one ready route, destination, and delivery rule';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.accepted_route_snapshot_at is not null and (
    new.payment_route_id is distinct from old.payment_route_id
    or new.payment_route_version is distinct from old.payment_route_version
    or new.legal_entity_snapshot is distinct from old.legal_entity_snapshot
    or new.charge_provider_snapshot is distinct from old.charge_provider_snapshot
    or new.charge_currency_snapshot is distinct from old.charge_currency_snapshot
    or new.payout_destination_id is distinct from old.payout_destination_id
    or new.fee_schedule_version_snapshot is distinct from old.fee_schedule_version_snapshot
    or new.delivery_country_rule_id is distinct from old.delivery_country_rule_id
    or new.delivery_country_rule_version is distinct from old.delivery_country_rule_version
    or new.tax_duty_snapshot is distinct from old.tax_duty_snapshot
    or new.accepted_earning_amount is distinct from old.accepted_earning_amount
    or new.tailor_terms_version_snapshot is distinct from old.tailor_terms_version_snapshot
    or new.commercial_policy_version is distinct from old.commercial_policy_version
    or new.accepted_route_snapshot_at is distinct from old.accepted_route_snapshot_at
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'orders_accepted_payment_route_snapshot_immutable',
      message = 'Accepted payment route snapshot is immutable';
  end if;
  return new;
end
$function$;
revoke all on function private.guard_accepted_payment_route_snapshot() from public,anon,authenticated;
grant execute on function private.guard_accepted_payment_route_snapshot() to service_role;

CREATE OR REPLACE FUNCTION public.guard_terminal_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_destination_keys constant text[] := array[
    'tailor_paystack_recipient_code_locked',
    'tailor_stripe_connect_account_id_locked',
    'tailor_payout_provider_locked',
    'tailor_payout_currency_locked',
    'updated_at'
  ];
  v_escrow_keys constant text[] := array['escrow_released','escrow_released_at','updated_at'];
begin
  if old.stage='COMPLETE'::public.order_stage
    and new.stage in ('PARTIALLY_REFUNDED'::public.order_stage,'REFUNDED'::public.order_stage)
    and new.escrow_released is not distinct from old.escrow_released
    and new.escrow_released_at is not distinct from old.escrow_released_at then
    return new;
  end if;
  if public.is_terminal_order_stage(old.stage) then
    if current_setting('app.reviewed_payout_destination_correction',true)='on'
      and (to_jsonb(new)-v_destination_keys)=(to_jsonb(old)-v_destination_keys) then
      return new;
    end if;
    if old.escrow_released is false and new.escrow_released is true
      and old.escrow_released_at is null
      and new.escrow_released_at is not null
      and (to_jsonb(new)-v_escrow_keys)=(to_jsonb(old)-v_escrow_keys)
      and exists (select 1 from payment_internal.staged_escrow_writes w
        join public.order_settlement_events e on e.id=w.event_id
          and e.plan_id=w.plan_id and e.event_type='PLAN_ESCROW_RELEASED'
        where w.order_id=old.id and w.transaction_id=txid_current()
          and w.backend_pid=pg_backend_pid()
          and w.created_at::timestamp(3)=new.escrow_released_at
          and private.staged_settlement_escrow_release_ready(w.order_id,w.plan_id)) then
      return new;
    end if;
    -- Preserve the existing claim/payout/ledger-bound legacy escrow writer.
    if old.escrow_released is false and new.escrow_released is true
      and old.escrow_released_at is null and new.escrow_released_at is not null
      and (to_jsonb(new)-v_escrow_keys)=(to_jsonb(old)-v_escrow_keys)
      and exists (select 1 from payment_internal.legacy_escrow_writes w
        where w.order_id=old.id and w.transaction_id=txid_current()
          and w.backend_pid=pg_backend_pid()
          and w.created_at=new.escrow_released_at) then
      return new;
    end if;
    raise exception 'Terminal order % at stage % cannot be mutated.',old.id,old.stage
      using errcode='P0001';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_terminal_order_update() from public,anon,authenticated;
grant execute on function public.guard_terminal_order_update() to service_role;
