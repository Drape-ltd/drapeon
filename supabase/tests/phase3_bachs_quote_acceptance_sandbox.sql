-- Verify Bachs can be snapshotted only for Dev SANDBOX_ONLY routes. The Edge
-- caller independently requires the exact Dev host and feature flag.
do $$
declare
  v_custom text;
  v_ready_made text;
begin
  select pg_get_functiondef(
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_custom;
  select pg_get_functiondef(
    'public.snapshot_ready_made_payment_route(text,uuid,uuid,integer,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_ready_made;

  if position('v_route.provider = ''BACHS''' in v_custom) = 0
    or position('v_environment <> ''SANDBOX''' in v_custom) = 0
    or position('v_route.status <> ''SANDBOX_ONLY''' in v_custom) = 0
    or position('elsif v_route.provider <> ''STRIPE''' in v_custom) = 0 then
    raise exception 'Custom quote acceptance is missing its Dev-only Bachs guard';
  end if;
  if position('v_route.provider = ''BACHS''' in v_ready_made) = 0
    or position('v_environment <> ''SANDBOX''' in v_ready_made) = 0
    or position('v_route.status <> ''SANDBOX_ONLY''' in v_ready_made) = 0
    or position('elsif v_route.provider <> ''STRIPE''' in v_ready_made) = 0 then
    raise exception 'Ready-made acceptance is missing its Dev-only Bachs guard';
  end if;
  if position(E'\n  if v_route.provider <> ''STRIPE'' then' in v_custom) > 0
    or position(E'\n  if v_route.provider <> ''STRIPE'' then' in v_ready_made) > 0 then
    raise exception 'The obsolete Stripe-only acceptance guard remains';
  end if;
end;
$$;
