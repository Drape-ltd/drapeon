drop function if exists public.ops_disable_payment_route(uuid, uuid, text);
drop function if exists public.ops_disable_delivery_country_rule(uuid, uuid, text);

drop trigger if exists payment_routes_audit_event on public.payment_routes;
create trigger payment_routes_audit_event
after insert or update on public.payment_routes
for each row execute function private.audit_payment_route_change();

drop trigger if exists delivery_country_rules_audit_event on public.delivery_country_rules;
create trigger delivery_country_rules_audit_event
after insert or update on public.delivery_country_rules
for each row execute function private.audit_delivery_country_rule_change();

drop function if exists private.audit_payment_route_change_with_workforce_actor();
drop function if exists private.audit_delivery_country_rule_change_with_workforce_actor();

alter table public.payment_route_audit_events
  drop column if exists actor_workforce_principal_id;
alter table public.delivery_country_audit_events
  drop column if exists actor_workforce_principal_id;
