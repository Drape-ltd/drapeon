-- Quote acceptance pins the already-resolved route and delivery rule in the
-- same transaction that accepts the quote. The shared TypeScript resolver
-- chooses the route; this function validates the exact selection against the
-- live, versioned configuration and snapshots it atomically.

create or replace function public.accept_active_order_quote_with_route_snapshot(
  p_order_id text,
  p_customer_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer,
  p_payment_route_id uuid,
  p_payment_route_version integer,
  p_delivery_country_rule_id uuid,
  p_delivery_country_rule_version integer,
  p_payout_destination_id uuid,
  p_delivery_country_code text,
  p_tailor_terms_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_route public.payment_routes%rowtype;
  v_delivery_rule public.delivery_country_rules%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_environment text;
  v_matching_route_count integer;
  v_matching_destination_count integer;
  v_delivery_country text := upper(trim(coalesce(p_delivery_country_code, '')));
  v_terms_version text := nullif(trim(coalesce(p_tailor_terms_version, '')), '');
  v_tax_duty_snapshot jsonb;
  v_event_id uuid;
begin
  if p_payment_route_id is null
    or p_payment_route_version is null
    or p_delivery_country_rule_id is null
    or p_delivery_country_rule_version is null
    or p_payout_destination_id is null
    or v_delivery_country !~ '^[A-Z]{2}$'
    or v_terms_version is null
    or length(v_terms_version) > 120 then
    raise exception 'PAYMENT_ROUTE_SNAPSHOT_INPUT_INVALID';
  end if;

  select * into v_order
  from public.orders
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
  for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.stage::text <> 'QUOTE_SENT' then
    raise exception 'QUOTE_ACCEPTANCE_NOT_AVAILABLE';
  end if;
  if v_order.order_kind::text is distinct from 'CUSTOM' then
    raise exception 'PAYMENT_ROUTE_SNAPSHOT_CUSTOM_ORDER_REQUIRED';
  end if;
  if v_order.delivery_method is null then
    raise exception 'PAYMENT_ROUTE_ORDER_SNAPSHOT_MISMATCH';
  end if;
  if v_order.accepted_route_snapshot_at is not null then
    raise exception 'PAYMENT_ROUTE_SNAPSHOT_ALREADY_ACCEPTED';
  end if;
  if exists (
    select 1 from public.quote_revision_requests
    where order_id::text = p_order_id and status = 'OPEN'
  ) then
    raise exception 'QUOTE_REVISION_STILL_OPEN';
  end if;

  select * into v_quote
  from public.order_quotes
  where id = p_quote_id
    and order_id::text = p_order_id
    and version = p_expected_quote_version
    and status = 'ACTIVE'
  for update;
  if v_quote.id is null
    or v_order.active_quote_id is distinct from p_quote_id
    or v_order.active_quote_version is distinct from p_expected_quote_version then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  select * into v_profile
  from public.tailor_profiles
  where id = v_order.tailor_profile_id
  for share;
  if v_profile.id is null then raise exception 'PAYMENT_ROUTE_TAILOR_NOT_FOUND'; end if;

  select * into v_route
  from public.payment_routes
  where id = p_payment_route_id
    and version = p_payment_route_version
  for share;
  if v_route.id is null then raise exception 'PAYMENT_ROUTE_NOT_FOUND'; end if;
  select count(*) into v_matching_route_count
  from public.payment_routes candidate
  where candidate.tailor_country_code = v_route.tailor_country_code
    and candidate.charge_currency = v_route.charge_currency
    and candidate.payout_currency = v_route.payout_currency
    and candidate.version >= v_route.version;
  if v_matching_route_count <> 1 then
    raise exception 'PAYMENT_ROUTE_VERSION_STALE';
  end if;

  select * into v_delivery_rule
  from public.delivery_country_rules
  where id = p_delivery_country_rule_id
    and version = p_delivery_country_rule_version
  for share;
  if v_delivery_rule.id is null then raise exception 'DELIVERY_COUNTRY_RULE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.delivery_country_rules newer
    where newer.country_code = v_delivery_rule.country_code
      and newer.version > v_delivery_rule.version
  ) then
    raise exception 'DELIVERY_COUNTRY_RULE_VERSION_STALE';
  end if;

  select * into v_destination
  from public.payout_destinations
  where id = p_payout_destination_id
  for share;
  if v_destination.id is null then raise exception 'PAYOUT_DESTINATION_NOT_FOUND'; end if;

  select count(*) into v_matching_destination_count
  from public.payout_destinations candidate
  where candidate.tailor_profile_id = v_order.tailor_profile_id
    and candidate.provider = v_route.provider
    and candidate.legal_entity = v_route.legal_entity
    and candidate.country_code = v_route.tailor_country_code
    and candidate.currency = v_route.payout_currency
    and candidate.fees_collector = v_route.fees_collector
    and candidate.active
    and candidate.transfers_enabled
    and candidate.payouts_enabled
    and candidate.first_withdrawal_review_status = 'CLEARED'
    and candidate.capability_checked_at is not null;
  if v_matching_destination_count <> 1 then
    raise exception 'PAYMENT_ROUTE_DESTINATION_NOT_UNIQUE';
  end if;

  v_environment := case public.current_ops_environment()
    when 'DEVELOPMENT' then 'SANDBOX'
    when 'PRODUCTION' then 'PRODUCTION'
    else 'UNKNOWN'
  end;

  if v_environment = 'UNKNOWN'
    or v_route.status = 'DISABLED'
    or (v_route.status = 'SANDBOX_ONLY' and v_environment <> 'SANDBOX') then
    raise exception 'PAYMENT_ROUTE_NOT_AVAILABLE';
  end if;
  -- Bachs remains deliberately closed until its complete collection-to-withdrawal
  -- path has been wired and proven by the separate provider phase.
  if v_route.provider <> 'STRIPE' then
    raise exception 'PAYMENT_ROUTE_PATH_NOT_READY';
  end if;
  if v_route.provider is distinct from v_order.tailor_payout_provider_locked::text
    or v_route.provider is distinct from public.resolve_payment_provider_for_currency(
      v_route.charge_currency::public.currency
    )::text
    or v_route.tailor_country_code <> upper(coalesce(v_profile.payout_country_code, ''))
    or v_route.tailor_country_code <> upper(coalesce(v_destination.country_code, ''))
    or v_route.payout_currency <> v_order.tailor_payout_currency_locked::text
    or v_route.charge_currency <> v_quote.currency
    or v_route.charge_currency <> v_order.currency::text
    or v_route.legal_entity <> v_destination.legal_entity
    or v_route.provider <> v_destination.provider
    or v_route.payout_currency <> v_destination.currency
    or v_route.fees_collector <> v_destination.fees_collector
    or v_destination.tailor_profile_id is distinct from v_order.tailor_profile_id
    or not v_destination.active
    or not v_destination.transfers_enabled
    or not v_destination.payouts_enabled
    or v_destination.first_withdrawal_review_status <> 'CLEARED'
    or v_destination.capability_checked_at is null then
    raise exception 'PAYMENT_ROUTE_CONFIGURATION_MISMATCH';
  end if;
  if v_delivery_rule.status <> 'READY'
    or v_delivery_rule.country_code <> v_delivery_country
    or (v_order.delivery_method::text = 'LOCAL_COLLECTION'
      and v_delivery_country <> upper(coalesce(v_profile.payout_country_code, '')))
    or (v_order.delivery_method::text <> 'LOCAL_COLLECTION'
      and upper(coalesce(v_order.delivery_country_code, '')) <> v_delivery_country) then
    raise exception 'DELIVERY_COUNTRY_NOT_AVAILABLE';
  end if;

  v_tax_duty_snapshot := jsonb_build_object(
    'countryCode', v_delivery_rule.country_code,
    'ruleVersion', v_delivery_rule.version,
    'domesticOnly', v_delivery_rule.domestic_only,
    'vatRegistrationReady', v_delivery_rule.vat_registration_ready,
    'collectVatUnderGbp135', v_delivery_rule.collect_vat_under_gbp_135,
    'dutiesCustomerPays', v_delivery_rule.duties_customer_pays,
    'iossReviewed', v_delivery_rule.ioss_reviewed,
    'taxAmount', v_quote.tax_amount,
    'deliveryFeeAmount', v_quote.delivery_fee_amount,
    'quoteTotalAmount', v_quote.total_amount
  );

  perform set_config('app.payment_route_snapshot_write', 'on', true);
  perform set_config('app.payment_environment', v_environment, true);

  update public.order_quotes
  set status = 'ACCEPTED'
  where id = v_quote.id and status = 'ACTIVE';
  if not found then raise exception 'QUOTE_VERSION_CHANGED'; end if;

  update public.orders
  set stage = 'PAYMENT_PENDING',
      stage_updated_at = now(),
      updated_at = now(),
      delivery_country_code = v_delivery_country,
      payment_provider = v_route.provider::public.payment_provider,
      tailor_payout_provider_locked = v_route.provider::public.payment_provider,
      tailor_paystack_recipient_code_locked = null,
      tailor_stripe_connect_account_id_locked = v_destination.provider_account_ref,
      payment_route_id = v_route.id,
      payment_route_version = v_route.version,
      legal_entity_snapshot = v_route.legal_entity,
      charge_provider_snapshot = v_route.provider,
      charge_currency_snapshot = v_route.charge_currency,
      payout_destination_id = v_destination.id,
      fee_schedule_version_snapshot = v_route.fee_schedule_version,
      delivery_country_rule_id = v_delivery_rule.id,
      delivery_country_rule_version = v_delivery_rule.version,
      tax_duty_snapshot = v_tax_duty_snapshot,
      accepted_earning_amount = v_quote.subtotal_amount,
      tailor_terms_version_snapshot = v_terms_version,
      accepted_route_snapshot_at = now()
  where id = v_order.id;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_ACCEPTED',
    p_customer_id,
    'CUSTOMER',
    'Quote accepted',
    'quote-accepted:' || v_quote.id::text,
    null,
    v_quote.id,
    v_quote.version,
    null,
    jsonb_build_object(
      'currency', v_quote.currency,
      'totalAmount', v_quote.total_amount,
      'paymentRouteId', v_route.id,
      'paymentRouteVersion', v_route.version,
      'legalEntity', v_route.legal_entity,
      'deliveryCountryRuleId', v_delivery_rule.id,
      'deliveryCountryRuleVersion', v_delivery_rule.version
    )
  );

  return jsonb_build_object(
    'quoteId', v_quote.id,
    'quoteVersion', v_quote.version,
    'eventId', v_event_id,
    'stage', 'PAYMENT_PENDING',
    'paymentRouteId', v_route.id,
    'paymentRouteVersion', v_route.version,
    'payoutDestinationId', v_destination.id,
    'legalEntity', v_route.legal_entity,
    'chargeProvider', v_route.provider,
    'chargeCurrency', v_route.charge_currency
  );
end;
$function$;

revoke all on function public.accept_active_order_quote_with_route_snapshot(
  text, uuid, uuid, integer, uuid, integer, uuid, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.accept_active_order_quote_with_route_snapshot(
  text, uuid, uuid, integer, uuid, integer, uuid, integer, uuid, text, text
) to service_role;

-- No legacy or direct stage update may accept a custom quote without the
-- canonical route snapshot. The new acceptance RPC writes both atomically.
create or replace function private.require_route_snapshot_for_quote_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.stage::text = 'QUOTE_SENT'
    and new.stage::text = 'PAYMENT_PENDING'
    and old.order_kind::text = 'CUSTOM'
    and new.accepted_route_snapshot_at is null then
    raise exception using
      errcode = '23514',
      constraint = 'orders_quote_acceptance_requires_route_snapshot',
      message = 'A custom quote cannot be accepted without its payment route snapshot';
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_quote_acceptance_requires_route_snapshot on public.orders;
create trigger orders_quote_acceptance_requires_route_snapshot
before update of stage on public.orders
for each row
execute function private.require_route_snapshot_for_quote_acceptance();

revoke all on function private.require_route_snapshot_for_quote_acceptance() from public, anon, authenticated;
grant execute on function private.require_route_snapshot_for_quote_acceptance() to service_role;

-- The previous RPC lacks route inputs and is no longer a valid acceptance path.
revoke all on function public.accept_active_order_quote(text, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
