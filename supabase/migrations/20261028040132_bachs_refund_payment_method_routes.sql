-- Hosted checkout defaults to every method enabled on the merchant account.
-- NGN bank transfer has no Bachs refund route, so collection methods must be
-- frozen on the payment route and passed explicitly at checkout.

alter table public.payment_routes
  add column if not exists payment_method_types text[] not null default '{}'::text[];

update public.payment_routes
set payment_method_types = array['NGN_CARD']::text[]
where provider = 'BACHS'
  and charge_currency = 'NGN'
  and cardinality(payment_method_types) = 0;

do $$
begin
  if exists (
    select 1 from public.payment_routes
    where provider = 'BACHS'
      and (charge_currency <> 'NGN' or payment_method_types is distinct from array['NGN_CARD']::text[])
  ) then
    raise exception 'Existing Bachs route is not the supported refundable NGN card corridor; reconcile it before applying.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_routes'::regclass
      and conname = 'payment_routes_bachs_refundable_methods_check'
  ) then
    alter table public.payment_routes
      add constraint payment_routes_bachs_refundable_methods_check
      check (provider <> 'BACHS' or (charge_currency = 'NGN' and payment_method_types = array['NGN_CARD']::text[]));
  end if;
end
$$;

create or replace function private.default_bachs_refundable_methods()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.provider = 'BACHS' then
    if new.charge_currency <> 'NGN'
      or cardinality(new.payment_method_types) not in (0, 1)
      or (cardinality(new.payment_method_types) = 1
        and new.payment_method_types is distinct from array['NGN_CARD']::text[]) then
      raise exception using errcode = '23514', constraint = 'payment_routes_bachs_refundable_methods_check',
        message = 'This Phase 3 Bachs route supports only its refund-capable configured card corridor';
    end if;
    new.payment_method_types := array['NGN_CARD']::text[];
  elsif cardinality(new.payment_method_types) > 0 then
    raise exception using errcode = '23514', constraint = 'payment_routes_bachs_refundable_methods_check',
      message = 'Collection payment methods are configured only for the Bachs route in this release';
  end if;
  return new;
end
$$;

create trigger payment_routes_default_bachs_refundable_methods
  before insert on public.payment_routes
  for each row execute function private.default_bachs_refundable_methods();

create or replace function private.guard_payment_route_methods_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.payment_method_types is distinct from old.payment_method_types then
    raise exception using errcode = '23514', constraint = 'payment_routes_versioned_methods_immutable',
      message = 'Payment-method configuration is immutable; create a new route version';
  end if;
  return new;
end
$$;

create trigger payment_routes_methods_immutable
  before update on public.payment_routes
  for each row execute function private.guard_payment_route_methods_immutable();

revoke all on function private.default_bachs_refundable_methods() from public, anon, authenticated;
revoke all on function private.guard_payment_route_methods_immutable() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payment_routes'::regclass
      and tgname = 'payment_routes_default_bachs_refundable_methods'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payment_routes'::regclass
      and tgname = 'payment_routes_methods_immutable'
      and not tgisinternal
  ) then
    raise exception 'Bachs payment-method route guards were not installed';
  end if;
  if exists (
    select 1 from public.payment_routes
    where provider = 'BACHS' and payment_method_types is distinct from array['NGN_CARD']::text[]
  ) then
    raise exception 'A Bachs route is missing its refund-capable collection method';
  end if;
end
$$;
