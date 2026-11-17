-- Keep the RPC signatures used by live Edge checkout after rolling back the
-- Bachs fee lock. Stripe remains supported through the canonical snapshot RPC;
-- Bachs fails closed because this rollback no longer locks its provider cost.
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
  v_provider text;
  v_total integer;
  v_result jsonb;
begin
  select provider::text into v_provider
  from public.payment_routes
  where id = p_payment_route_id and version = p_payment_route_version;
  if not found then raise exception 'PAYMENT_ROUTE_NOT_FOUND'; end if;
  if v_provider <> 'STRIPE' then raise exception 'PAYMENT_ROUTE_PATH_NOT_READY'; end if;

  select total_amount into v_total
  from public.order_quotes
  where id = p_quote_id and order_id::text = p_order_id
    and version = p_expected_quote_version and status = 'ACTIVE'
  for update;
  if not found then raise exception 'QUOTE_VERSION_CHANGED'; end if;

  v_result := public.accept_active_order_quote_with_route_snapshot(
    p_order_id, p_customer_id, p_quote_id, p_expected_quote_version,
    p_payment_route_id, p_payment_route_version, p_delivery_country_rule_id,
    p_delivery_country_rule_version, p_payout_destination_id,
    p_delivery_country_code, p_tailor_terms_version
  );
  return v_result || jsonb_build_object(
    'providerCostAmount', 0,
    'providerCostScheduleVersion', null,
    'totalAmount', v_total
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
  v_provider text;
  v_total integer;
  v_result jsonb;
begin
  select provider::text into v_provider
  from public.payment_routes
  where id = p_payment_route_id and version = p_payment_route_version;
  if not found then raise exception 'PAYMENT_ROUTE_NOT_FOUND'; end if;
  if v_provider <> 'STRIPE' then raise exception 'PAYMENT_ROUTE_PATH_NOT_READY'; end if;

  select total_amount into v_total
  from public.orders
  where id::text = p_order_id and customer_id::text = p_customer_id::text
    and order_kind::text = 'READY_MADE' and stage::text = 'PENDING_QUOTE'
  for update;
  if not found then raise exception 'READY_MADE_ROUTE_SNAPSHOT_NOT_AVAILABLE'; end if;

  v_result := public.snapshot_ready_made_payment_route(
    p_order_id, p_customer_id, p_payment_route_id, p_payment_route_version,
    p_delivery_country_rule_id, p_delivery_country_rule_version,
    p_payout_destination_id, p_delivery_country_code, p_tailor_terms_version
  );
  return v_result || jsonb_build_object(
    'providerCostAmount', 0,
    'providerCostScheduleVersion', null,
    'totalAmount', v_total
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
