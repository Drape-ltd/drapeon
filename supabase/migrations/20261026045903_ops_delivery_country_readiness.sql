-- Permit a named, fresh-MFA Ops admin to mark a delivery-country rule ready.
-- Readiness is still constrained by the country-specific table checks; this
-- operation does not enable a payment route.

create or replace function public.ops_ready_delivery_country_rule(
  p_rule_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_found boolean;
begin
  if p_rule_id is null or p_actor_id is null or length(trim(coalesce(p_reason, ''))) not between 12 and 1000 then
    raise exception using errcode = '22023', message = 'Delivery rule ID, authenticated Ops actor, and a reason between 12 and 1000 characters are required';
  end if;

  perform set_config('app.payment_route_actor_id', p_actor_id::text, true);
  perform set_config('app.payment_route_actor_principal_id', p_actor_id::text, true);
  perform set_config('app.payment_route_change_reason', trim(p_reason), true);

  update public.delivery_country_rules
  set status = 'READY'
  where id = p_rule_id and status <> 'READY';
  if found then
    insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
    values (
      p_actor_id::text,
      'ADMIN',
      'ops.delivery_country_rule_readied',
      'warn',
      jsonb_build_object('delivery_country_rule_id', p_rule_id, 'reason', trim(p_reason))
    );
    return;
  end if;

  select true into v_found from public.delivery_country_rules where id = p_rule_id;
  if not coalesce(v_found, false) then
    raise exception using errcode = 'P0002', message = 'Delivery-country rule was not found';
  end if;
end
$function$;

revoke all on function public.ops_ready_delivery_country_rule(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ops_ready_delivery_country_rule(uuid, uuid, text) to service_role;
