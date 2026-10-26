-- Narrow, audited Ops kill-switch operations for payment routes and delivery
-- country rules. These functions can only move configuration to DISABLED.

-- Workforce identities are not Supabase Auth users. Keep their audit attribution
-- separate from auth.uid()-based actor IDs instead of coercing one identity into
-- the other's foreign key.
alter table public.payment_route_audit_events
  add column if not exists actor_workforce_principal_id uuid
    references public.ops_workforce_principals(id) on delete set null;
alter table public.delivery_country_audit_events
  add column if not exists actor_workforce_principal_id uuid
    references public.ops_workforce_principals(id) on delete set null;

create or replace function private.audit_payment_route_change_with_workforce_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_workforce_actor_id uuid;
  v_reason text;
begin
  v_workforce_actor_id := nullif(current_setting('app.payment_route_actor_principal_id', true), '')::uuid;
  v_actor_id := auth.uid();
  if v_workforce_actor_id is null then
    v_actor_id := coalesce(v_actor_id, nullif(current_setting('app.payment_route_actor_id', true), '')::uuid);
  end if;
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');

  if tg_op = 'INSERT' then
    insert into public.payment_route_audit_events (
      route_id, actor_id, actor_workforce_principal_id, action, new_status, reason
    ) values (new.id, v_actor_id, v_workforce_actor_id, 'CREATED', new.status, v_reason);
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  insert into public.payment_route_audit_events (
    route_id, actor_id, actor_workforce_principal_id, action, previous_status, new_status, reason,
    evidence
  ) values (
    new.id, v_actor_id, v_workforce_actor_id, 'STATUS_CHANGED', old.status, new.status, v_reason,
    case when new.status = 'ENABLED' then jsonb_build_object(
      'enablement_request_id', new.active_enablement_request_id,
      'approvals', (
        select jsonb_agg(jsonb_build_object('approver_id', approval.approver_id, 'evidence', approval.evidence))
        from public.payment_route_approvals as approval
        where approval.route_id = new.id
          and approval.enablement_request_id = new.active_enablement_request_id
          and approval.approval_kind = 'ENABLE_ROUTE'
      )
    ) else '{}'::jsonb end
  );
  return new;
end
$function$;

create or replace function private.audit_delivery_country_rule_change_with_workforce_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_workforce_actor_id uuid;
  v_reason text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_workforce_actor_id := nullif(current_setting('app.payment_route_actor_principal_id', true), '')::uuid;
  v_actor_id := auth.uid();
  if v_workforce_actor_id is null then
    v_actor_id := coalesce(v_actor_id, nullif(current_setting('app.payment_route_actor_id', true), '')::uuid);
  end if;
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
  insert into public.delivery_country_audit_events (
    delivery_country_rule_id, actor_id, actor_workforce_principal_id, previous_status, new_status, reason
  ) values (
    new.id, v_actor_id, v_workforce_actor_id, case when tg_op = 'UPDATE' then old.status else null end,
    new.status, v_reason
  );
  return new;
end
$function$;

drop trigger if exists payment_routes_audit_event on public.payment_routes;
create trigger payment_routes_audit_event
after insert or update on public.payment_routes
for each row execute function private.audit_payment_route_change_with_workforce_actor();

drop trigger if exists delivery_country_rules_audit_event on public.delivery_country_rules;
create trigger delivery_country_rules_audit_event
after insert or update on public.delivery_country_rules
for each row execute function private.audit_delivery_country_rule_change_with_workforce_actor();

revoke all on function private.audit_payment_route_change_with_workforce_actor() from public, anon, authenticated;
revoke all on function private.audit_delivery_country_rule_change_with_workforce_actor() from public, anon, authenticated;
grant execute on function private.audit_payment_route_change_with_workforce_actor() to service_role;
grant execute on function private.audit_delivery_country_rule_change_with_workforce_actor() to service_role;

create or replace function public.ops_disable_payment_route(
  p_route_id uuid,
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
  if p_route_id is null or p_actor_id is null or length(trim(coalesce(p_reason, ''))) not between 12 and 1000 then
    raise exception using errcode = '22023', message = 'Route ID, authenticated Ops actor, and a reason between 12 and 1000 characters are required';
  end if;

  perform set_config('app.payment_route_actor_id', p_actor_id::text, true);
  perform set_config('app.payment_route_actor_principal_id', p_actor_id::text, true);
  perform set_config('app.payment_route_change_reason', trim(p_reason), true);

  update public.payment_routes
  set status = 'DISABLED'
  where id = p_route_id and status <> 'DISABLED';
  if found then
    insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
    values (
      p_actor_id::text,
      'ADMIN',
      'ops.payment_route_disabled',
      'warn',
      jsonb_build_object('route_id', p_route_id, 'reason', trim(p_reason))
    );
    return;
  end if;

  select true into v_found from public.payment_routes where id = p_route_id;
  if not coalesce(v_found, false) then
    raise exception using errcode = 'P0002', message = 'Payment route was not found';
  end if;
end
$function$;

create or replace function public.ops_disable_delivery_country_rule(
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
  set status = 'DISABLED'
  where id = p_rule_id and status <> 'DISABLED';
  if found then
    insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
    values (
      p_actor_id::text,
      'ADMIN',
      'ops.delivery_country_rule_disabled',
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

revoke all on function public.ops_disable_payment_route(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ops_disable_delivery_country_rule(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ops_disable_payment_route(uuid, uuid, text) to service_role;
grant execute on function public.ops_disable_delivery_country_rule(uuid, uuid, text) to service_role;
