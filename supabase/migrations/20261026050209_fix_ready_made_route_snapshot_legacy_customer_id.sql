-- Correct legacy text/UUID identifier comparisons discovered by linked Dev lint.
create or replace function public.snapshot_ready_made_payment_route(
  p_order_id text,
  p_customer_id uuid,
  p_payment_route_id uuid,
  p_payment_route_version integer,
  p_delivery_country_rule_id uuid,
  p_delivery_country_rule_version integer,
  p_payout_destination_id uuid,
  p_delivery_country_code text,
  p_tailor_terms_version text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_route public.payment_routes%rowtype;
  v_delivery_rule public.delivery_country_rules%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_environment text;
  v_country text := upper(trim(coalesce(p_delivery_country_code, '')));
  v_terms text := nullif(trim(coalesce(p_tailor_terms_version, '')), '');
  v_route_count integer;
  v_destination_count integer;
  v_earning integer;
  v_tax_duty_snapshot jsonb;
  v_event_id uuid;
begin
  if p_payment_route_id is null
    or p_payment_route_version is null
    or p_delivery_country_rule_id is null
    or p_delivery_country_rule_version is null
    or p_payout_destination_id is null
    or v_country !~ '^[A-Z]{2}$'
    or v_terms is null
    or length(v_terms) > 120 then
    raise exception 'PAYMENT_ROUTE_SNAPSHOT_INPUT_INVALID';
  end if;

  select * into v_order
  from public.orders
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.order_kind::text <> 'READY_MADE'
    or v_order.stage::text <> 'PENDING_QUOTE'
    or v_order.accepted_route_snapshot_at is not null then
    raise exception 'READY_MADE_ROUTE_SNAPSHOT_NOT_AVAILABLE';
  end if;

  select * into v_profile
  from public.tailor_profiles
  where id = v_order.tailor_profile_id
  for share;
  if not found then raise exception 'PAYMENT_ROUTE_TAILOR_NOT_FOUND'; end if;

  select * into v_route
  from public.payment_routes
  where id = p_payment_route_id
    and version = p_payment_route_version
  for share;
  if not found then raise exception 'PAYMENT_ROUTE_NOT_FOUND'; end if;

  select count(*) into v_route_count
  from public.payment_routes candidate
  where candidate.tailor_country_code = v_route.tailor_country_code
    and candidate.charge_currency = v_route.charge_currency
    and candidate.payout_currency = v_route.payout_currency
    and candidate.version >= v_route.version;
  if v_route_count <> 1 then raise exception 'PAYMENT_ROUTE_VERSION_STALE'; end if;

  select * into v_delivery_rule
  from public.delivery_country_rules
  where id = p_delivery_country_rule_id
    and version = p_delivery_country_rule_version
  for share;
  if not found then raise exception 'DELIVERY_COUNTRY_RULE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.delivery_country_rules newer
    where newer.country_code = v_delivery_rule.country_code
      and newer.version > v_delivery_rule.version
  ) then raise exception 'DELIVERY_COUNTRY_RULE_VERSION_STALE'; end if;

  select * into v_destination
  from public.payout_destinations
  where id = p_payout_destination_id
  for share;
  if not found then raise exception 'PAYOUT_DESTINATION_NOT_FOUND'; end if;

  select count(*) into v_destination_count
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
  if v_destination_count <> 1 then raise exception 'PAYMENT_ROUTE_DESTINATION_NOT_UNIQUE'; end if;

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
  -- Bachs remains closed until every charge and withdrawal phase is proven.
  if v_route.provider <> 'STRIPE' then raise exception 'PAYMENT_ROUTE_PATH_NOT_READY'; end if;

  v_earning := coalesce(v_order.item_subtotal, v_order.subtotal_amount);
  if v_earning is null or v_earning <= 0 then raise exception 'READY_MADE_EARNING_INVALID'; end if;
  if v_order.delivery_method::text = 'LOCAL_COLLECTION' then
    v_country := upper(coalesce(v_profile.payout_country_code, ''));
  end if;

  if v_route.tailor_country_code <> upper(coalesce(v_profile.payout_country_code, ''))
    or v_route.tailor_country_code <> upper(coalesce(v_destination.country_code, ''))
    or v_route.provider is distinct from v_order.tailor_payout_provider_locked::text
    or v_route.payout_currency <> v_order.tailor_payout_currency_locked::text
    or v_route.charge_currency <> v_order.currency::text
    or v_route.charge_currency <> v_order.quoted_currency::text
    or v_route.legal_entity <> v_destination.legal_entity
    or v_route.provider <> v_destination.provider
    or v_route.payout_currency <> v_destination.currency
    or v_route.fees_collector <> v_destination.fees_collector
    or v_destination.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text
    or not v_destination.active
    or not v_destination.transfers_enabled
    or not v_destination.payouts_enabled
    or v_destination.first_withdrawal_review_status <> 'CLEARED'
    or v_delivery_rule.country_code <> v_country
    or v_delivery_rule.status <> 'READY'
    or (v_order.delivery_method::text = 'LOCAL_COLLECTION'
      and v_country <> upper(coalesce(v_profile.payout_country_code, '')))
    or (v_order.delivery_method::text <> 'LOCAL_COLLECTION'
      and upper(coalesce(v_order.delivery_country_code, '')) <> v_country) then
    raise exception 'PAYMENT_ROUTE_ORDER_SNAPSHOT_MISMATCH';
  end if;

  v_tax_duty_snapshot := jsonb_build_object(
    'countryCode', v_delivery_rule.country_code,
    'ruleVersion', v_delivery_rule.version,
    'domesticOnly', v_delivery_rule.domestic_only,
    'vatRegistrationReady', v_delivery_rule.vat_registration_ready,
    'collectVatUnderGbp135', v_delivery_rule.collect_vat_under_gbp_135,
    'dutiesCustomerPays', v_delivery_rule.duties_customer_pays,
    'iossReviewed', v_delivery_rule.ioss_reviewed,
    'taxAmount', coalesce(v_order.tax_amount, 0),
    'deliveryFeeAmount', coalesce(v_order.shipping_amount, 0),
    'quoteTotalAmount', coalesce(v_order.total_amount, 0)
  );

  perform set_config('app.payment_route_snapshot_write', 'on', true);
  perform set_config('app.payment_environment', v_environment, true);

  update public.orders
  set stage = 'PAYMENT_PENDING',
      stage_updated_at = now(),
      updated_at = now(),
      delivery_country_code = v_country,
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
      accepted_earning_amount = v_earning,
      tailor_terms_version_snapshot = v_terms,
      commercial_policy_version = 'commercial-2026-07-31-v1',
      accepted_route_snapshot_at = now()
  where id = v_order.id;

  v_event_id := public.record_order_event(
    p_order_id,
    'READY_MADE_CHECKOUT_ACCEPTED',
    p_customer_id,
    'CUSTOMER',
    'Ready-made checkout started',
    'ready-made-checkout-accepted:' || v_order.id::text,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'paymentRouteId', v_route.id,
      'paymentRouteVersion', v_route.version,
      'legalEntity', v_route.legal_entity,
      'deliveryCountryRuleId', v_delivery_rule.id,
      'deliveryCountryRuleVersion', v_delivery_rule.version
    )
  );

  return jsonb_build_object(
    'orderId', v_order.id,
    'paymentRouteId', v_route.id,
    'paymentRouteVersion', v_route.version,
    'deliveryCountryRuleId', v_delivery_rule.id,
    'deliveryCountryRuleVersion', v_delivery_rule.version,
    'payoutDestinationId', v_destination.id,
    'eventId', v_event_id,
    'stage', 'PAYMENT_PENDING',
    'acceptedEarningAmount', v_earning
  );
end;
$function$;

revoke all on function public.snapshot_ready_made_payment_route(text, uuid, uuid, integer, uuid, integer, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.snapshot_ready_made_payment_route(text, uuid, uuid, integer, uuid, integer, uuid, text, text)
  to service_role;
