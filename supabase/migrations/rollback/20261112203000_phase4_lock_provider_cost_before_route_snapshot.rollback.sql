-- Restore the two wrappers from 20261112201000. Do not drop checkout RPCs:
-- live callers may use them while the forward chain is being rehearsed.

create or replace function public.accept_active_order_quote_with_route_snapshot_v2(
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
set search_path = ''
as $function$
declare
  v_route public.payment_routes%rowtype;
  v_quote public.order_quotes%rowtype;
  v_result jsonb;
  v_provider_cost integer := 0;
  v_customer_total integer;
begin
  select * into v_route
  from public.payment_routes
  where id = p_payment_route_id
    and version = p_payment_route_version;
  if not found then raise exception 'PAYMENT_ROUTE_NOT_FOUND'; end if;

  select * into v_quote
  from public.order_quotes
  where id = p_quote_id
    and order_id::text = p_order_id
    and version = p_expected_quote_version
    and status = 'ACTIVE';
  if not found then raise exception 'QUOTE_VERSION_CHANGED'; end if;

  if v_route.provider = 'BACHS' then
    if v_route.charge_currency <> 'NGN'
      or v_route.payout_currency <> 'NGN'
      or v_route.fee_schedule_version <> 'ngn-card-provider-cost-2pct-v1' then
      raise exception 'PAYMENT_ROUTE_FEE_SCHEDULE_UNAVAILABLE';
    end if;
    if v_quote.platform_fee_amount <> 0 then
      raise exception 'BACHS_ZERO_COMMISSION_REQUIRED';
    end if;
    v_provider_cost := floor(((v_quote.total_amount::numeric * 200) + 5000) / 10000)::integer;
  end if;

  v_customer_total := v_quote.total_amount + v_provider_cost;
  if v_customer_total <= 0 then raise exception 'PAYMENT_ROUTE_TOTAL_INVALID'; end if;

  v_result := public.accept_active_order_quote_with_route_snapshot(
    p_order_id,
    p_customer_id,
    p_quote_id,
    p_expected_quote_version,
    p_payment_route_id,
    p_payment_route_version,
    p_delivery_country_rule_id,
    p_delivery_country_rule_version,
    p_payout_destination_id,
    p_delivery_country_code,
    p_tailor_terms_version
  );

  update public.orders
  set platform_fee_amount = coalesce(platform_fee_amount, 0) + v_provider_cost,
      total_amount = v_customer_total,
      quoted_amount = v_customer_total,
      tax_duty_snapshot = coalesce(tax_duty_snapshot, '{}'::jsonb) || jsonb_build_object(
        'providerCostAmount', v_provider_cost,
        'providerCostScheduleVersion', v_route.fee_schedule_version,
        'acceptedCustomerTotalAmount', v_customer_total
      )
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
    and payment_route_id = v_route.id
    and payment_route_version = v_route.version
    and accepted_route_snapshot_at is not null
    and payment_intent_id is null;
  if not found then raise exception 'PAYMENT_ROUTE_PROVIDER_COST_LOCK_FAILED'; end if;

  return v_result || jsonb_build_object(
    'providerCostAmount', v_provider_cost,
    'providerCostScheduleVersion', v_route.fee_schedule_version,
    'totalAmount', v_customer_total
  );
end
$function$;

create or replace function public.snapshot_ready_made_payment_route_v2(
  p_order_id text,
  p_customer_id uuid,
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
set search_path = ''
as $function$
declare
  v_route public.payment_routes%rowtype;
  v_order public.orders%rowtype;
  v_result jsonb;
  v_provider_cost integer := 0;
  v_customer_total integer;
begin
  select * into v_route
  from public.payment_routes
  where id = p_payment_route_id
    and version = p_payment_route_version;
  if not found then raise exception 'PAYMENT_ROUTE_NOT_FOUND'; end if;

  select * into v_order
  from public.orders
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
    and order_kind::text = 'READY_MADE'
    and stage::text = 'PENDING_QUOTE';
  if not found then raise exception 'READY_MADE_ROUTE_SNAPSHOT_NOT_AVAILABLE'; end if;

  if v_route.provider = 'BACHS' then
    if v_route.charge_currency <> 'NGN'
      or v_route.payout_currency <> 'NGN'
      or v_route.fee_schedule_version <> 'ngn-card-provider-cost-2pct-v1' then
      raise exception 'PAYMENT_ROUTE_FEE_SCHEDULE_UNAVAILABLE';
    end if;
    if coalesce(v_order.platform_fee_amount, 0) <> 0 then
      raise exception 'BACHS_ZERO_COMMISSION_REQUIRED';
    end if;
    v_provider_cost := floor(((v_order.total_amount::numeric * 200) + 5000) / 10000)::integer;
  end if;

  v_customer_total := v_order.total_amount + v_provider_cost;
  if v_customer_total <= 0 then raise exception 'PAYMENT_ROUTE_TOTAL_INVALID'; end if;

  v_result := public.snapshot_ready_made_payment_route(
    p_order_id,
    p_customer_id,
    p_payment_route_id,
    p_payment_route_version,
    p_delivery_country_rule_id,
    p_delivery_country_rule_version,
    p_payout_destination_id,
    p_delivery_country_code,
    p_tailor_terms_version
  );

  update public.orders
  set platform_fee_amount = coalesce(platform_fee_amount, 0) + v_provider_cost,
      total_amount = v_customer_total,
      quoted_amount = v_customer_total,
      tax_duty_snapshot = coalesce(tax_duty_snapshot, '{}'::jsonb) || jsonb_build_object(
        'providerCostAmount', v_provider_cost,
        'providerCostScheduleVersion', v_route.fee_schedule_version,
        'acceptedCustomerTotalAmount', v_customer_total
      )
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
    and payment_route_id = v_route.id
    and payment_route_version = v_route.version
    and accepted_route_snapshot_at is not null
    and payment_intent_id is null;
  if not found then raise exception 'PAYMENT_ROUTE_PROVIDER_COST_LOCK_FAILED'; end if;

  return v_result || jsonb_build_object(
    'providerCostAmount', v_provider_cost,
    'providerCostScheduleVersion', v_route.fee_schedule_version,
    'totalAmount', v_customer_total
  );
end
$function$;

revoke all on function public.accept_active_order_quote_with_route_snapshot_v2(
  text, uuid, uuid, integer, uuid, integer, uuid, integer, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.snapshot_ready_made_payment_route_v2(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.accept_active_order_quote_with_route_snapshot_v2(
  text, uuid, uuid, integer, uuid, integer, uuid, integer, uuid, text, text
) to service_role;
grant execute on function public.snapshot_ready_made_payment_route_v2(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) to service_role;
