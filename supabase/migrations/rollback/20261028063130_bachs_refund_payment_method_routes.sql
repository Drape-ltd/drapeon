do $$
begin
  if exists (
    select 1 from public.payment_routes
    where provider = 'BACHS' and status <> 'DISABLED'
  ) then
    raise exception 'Refusing to remove Bachs refund-safe method guards while any Bachs route is not DISABLED';
  end if;
end
$$;

drop trigger if exists payment_routes_methods_immutable on public.payment_routes;
drop trigger if exists payment_routes_default_bachs_refundable_methods on public.payment_routes;
drop function if exists private.guard_payment_route_methods_immutable();
drop function if exists private.default_bachs_refundable_methods();
alter table public.payment_routes drop constraint if exists payment_routes_bachs_refundable_methods_check;
alter table public.payment_routes drop column if exists payment_method_types;
