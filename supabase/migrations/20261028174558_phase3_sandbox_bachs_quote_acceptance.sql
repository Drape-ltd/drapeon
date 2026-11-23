-- Complete the Dev-only Bachs sandbox acceptance path already gated by the
-- shared route resolver and Edge feature flag. This does not enable any route.
do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_old := $old$  -- Bachs remains deliberately closed until its complete collection-to-withdrawal
  -- path has been wired and proven by the separate provider phase.
  if v_route.provider <> 'STRIPE' then
    raise exception 'PAYMENT_ROUTE_PATH_NOT_READY';
  end if;$old$;
  v_new := $new$  -- Bachs sandbox acceptance is restricted to the verified Dev environment
  -- and an explicitly SANDBOX_ONLY route. Production enablement is a separate
  -- Phase 4 decision after live corridor proof.
  if v_route.provider = 'BACHS' then
    if v_environment <> 'SANDBOX' or v_route.status <> 'SANDBOX_ONLY' then
      raise exception 'PAYMENT_ROUTE_PATH_NOT_READY';
    end if;
  elsif v_route.provider <> 'STRIPE' then
    raise exception 'PAYMENT_ROUTE_PATH_NOT_READY';
  end if;$new$;

  select pg_get_functiondef(
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'Custom quote route guard differs from the reviewed Stripe-only contract';
  end if;
  execute replace(v_definition, v_old, v_new);

  v_old := $old$  -- Bachs remains closed until every charge and withdrawal phase is proven.
  if v_route.provider <> 'STRIPE' then raise exception 'PAYMENT_ROUTE_PATH_NOT_READY'; end if;$old$;
  v_new := $new$  -- Bachs sandbox acceptance is restricted to the verified Dev environment
  -- and an explicitly SANDBOX_ONLY route. Production enablement is a separate
  -- Phase 4 decision after live corridor proof.
  if v_route.provider = 'BACHS' then
    if v_environment <> 'SANDBOX' or v_route.status <> 'SANDBOX_ONLY' then
      raise exception 'PAYMENT_ROUTE_PATH_NOT_READY';
    end if;
  elsif v_route.provider <> 'STRIPE' then
    raise exception 'PAYMENT_ROUTE_PATH_NOT_READY';
  end if;$new$;

  select pg_get_functiondef(
    'public.snapshot_ready_made_payment_route(text,uuid,uuid,integer,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'Ready-made route guard differs from the reviewed Stripe-only contract';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;
