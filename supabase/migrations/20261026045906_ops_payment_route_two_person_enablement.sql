-- Route activation requires two distinct named Ops workforce principals and
-- four evidence references per approver. No route is enabled by this migration.

create table public.payment_route_enablement_requests (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.payment_routes(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN', 'ENABLED', 'CANCELLED')),
  created_by_workforce_principal_id uuid not null references public.ops_workforce_principals(id) on delete restrict,
  reason text not null check (length(trim(reason)) between 12 and 1000),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, route_id),
  check ((status = 'OPEN' and completed_at is null) or (status <> 'OPEN' and completed_at is not null))
);

create unique index payment_route_enablement_one_open_request_per_route
  on public.payment_route_enablement_requests (route_id) where status = 'OPEN';
create index payment_route_enablement_requests_recent_idx
  on public.payment_route_enablement_requests (status, created_at desc);

alter table public.payment_route_approvals
  alter column approver_id drop not null,
  add column approver_workforce_principal_id uuid
    references public.ops_workforce_principals(id) on delete restrict,
  add column approver_email text;

alter table public.payment_route_approvals
  add constraint payment_route_approvals_exactly_one_approver_check
  check ((approver_id is null) <> (approver_workforce_principal_id is null)),
  add constraint payment_route_approvals_request_fk
  foreign key (enablement_request_id, route_id)
  references public.payment_route_enablement_requests (id, route_id) on delete restrict;

alter table public.payment_route_approvals
  drop constraint payment_route_approvals_route_id_enablement_request_id_appr_key;
create unique index payment_route_approvals_auth_actor_unique
  on public.payment_route_approvals (route_id, enablement_request_id, approval_kind, approver_id)
  where approver_id is not null;
create unique index payment_route_approvals_workforce_actor_unique
  on public.payment_route_approvals (route_id, enablement_request_id, approval_kind, approver_workforce_principal_id)
  where approver_workforce_principal_id is not null;

create or replace function private.guard_payment_route_enablement_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'OPEN' or new.completed_at is not null then
      raise exception using errcode = '23514', message = 'Route enablement requests must start open';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.route_id is distinct from old.route_id
    or new.created_by_workforce_principal_id is distinct from old.created_by_workforce_principal_id
    or new.reason is distinct from old.reason
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514', message = 'Route enablement request identity is immutable';
  end if;
  if old.status <> 'OPEN' or new.status not in ('ENABLED', 'CANCELLED') or new.completed_at is null then
    raise exception using errcode = '23514', message = 'Route enablement requests can only complete once';
  end if;
  return new;
end
$function$;

create trigger payment_route_enablement_request_guard
before insert or update on public.payment_route_enablement_requests
for each row execute function private.guard_payment_route_enablement_request();

create or replace function private.cancel_open_payment_route_enablement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'DISABLED' and old.status is distinct from new.status then
    update public.payment_route_enablement_requests
    set status = 'CANCELLED', completed_at = now()
    where route_id = new.id and status = 'OPEN';
  end if;
  return new;
end
$function$;

create trigger payment_routes_cancel_open_enablement
after update of status on public.payment_routes
for each row execute function private.cancel_open_payment_route_enablement();

create or replace function private.guard_payment_route_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_reason text;
  v_approver_count integer;
  v_evidence_complete boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DISABLED' or new.active_enablement_request_id is not null then
      raise exception using errcode = '23514', constraint = 'payment_routes_created_disabled', message = 'Payment routes must be created disabled';
    end if;
    v_actor_id := coalesce(auth.uid(), nullif(current_setting('app.payment_route_actor_id', true), '')::uuid);
    v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
    if v_actor_id is null or v_reason is null then
      raise exception using errcode = '23514', constraint = 'payment_routes_creation_audited', message = 'Route creation requires an actor and reason';
    end if;
    new.created_by := coalesce(new.created_by, v_actor_id);
    return new;
  end if;

  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
    or new.route_key is distinct from old.route_key
    or new.version is distinct from old.version
    or new.tailor_country_code is distinct from old.tailor_country_code
    or new.charge_currency is distinct from old.charge_currency
    or new.payout_currency is distinct from old.payout_currency
    or new.provider is distinct from old.provider
    or new.legal_entity is distinct from old.legal_entity
    or new.fees_collector is distinct from old.fees_collector
    or new.fee_schedule_version is distinct from old.fee_schedule_version
    or new.confirmed_card_issuer_countries is distinct from old.confirmed_card_issuer_countries then
    raise exception using errcode = '23514', constraint = 'payment_routes_versioned_config_immutable', message = 'Payment route configuration is immutable; create a new version';
  end if;

  if new.status is distinct from old.status then
    v_actor_id := coalesce(auth.uid(), nullif(current_setting('app.payment_route_actor_id', true), '')::uuid);
    v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
    if v_actor_id is null or v_reason is null then
      raise exception using errcode = '23514', constraint = 'payment_routes_status_change_audited', message = 'Route status changes require an actor and reason';
    end if;

    if new.status = 'ENABLED' then
      if new.active_enablement_request_id is null or not exists (
        select 1 from public.payment_route_enablement_requests request
        where request.id = new.active_enablement_request_id
          and request.route_id = new.id
          and request.status = 'OPEN'
      ) then
        raise exception using errcode = '23514', constraint = 'payment_routes_enablement_request_required', message = 'Route enablement requires an open approval request';
      end if;

      select count(distinct coalesce(approval.approver_workforce_principal_id::text, approval.approver_id::text)),
        coalesce(bool_and(
          nullif(trim(approval.evidence ->> 'collection'), '') is not null
          and nullif(trim(approval.evidence ->> 'settlement'), '') is not null
          and nullif(trim(approval.evidence ->> 'transfer'), '') is not null
          and nullif(trim(approval.evidence ->> 'tailor_withdrawal'), '') is not null
          and (new.provider <> 'BACHS' or nullif(trim(approval.evidence ->> 'provider_confirmation'), '') is not null)
        ), false)
      into v_approver_count, v_evidence_complete
      from public.payment_route_approvals approval
      where approval.route_id = new.id
        and approval.enablement_request_id = new.active_enablement_request_id
        and approval.approval_kind = 'ENABLE_ROUTE';

      if v_approver_count < 2 or not v_evidence_complete then
        raise exception using errcode = '23514', constraint = 'payment_routes_two_approver_evidence_required', message = 'Route enablement requires two distinct approvers and complete evidence';
      end if;
    else
      new.active_enablement_request_id := null;
    end if;
    new.updated_at := now();
  elsif new.active_enablement_request_id is distinct from old.active_enablement_request_id then
    raise exception using errcode = '23514', constraint = 'payment_routes_request_changes_with_status', message = 'Route approval request can change only with an audited status change';
  elsif new.updated_at is distinct from old.updated_at then
    raise exception using errcode = '23514', constraint = 'payment_routes_updated_at_managed', message = 'Route update timestamp is managed by the database';
  end if;
  return new;
end
$function$;

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
    insert into public.payment_route_audit_events (route_id, actor_id, actor_workforce_principal_id, action, new_status, reason)
    values (new.id, v_actor_id, v_workforce_actor_id, 'CREATED', new.status, v_reason);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;

  insert into public.payment_route_audit_events (
    route_id, actor_id, actor_workforce_principal_id, action, previous_status, new_status, reason, evidence
  ) values (
    new.id, v_actor_id, v_workforce_actor_id, 'STATUS_CHANGED', old.status, new.status, v_reason,
    case when new.status = 'ENABLED' then jsonb_build_object(
      'enablement_request_id', new.active_enablement_request_id,
      'approvals', (
        select jsonb_agg(jsonb_build_object(
          'approver_id', approval.approver_id,
          'approver_workforce_principal_id', approval.approver_workforce_principal_id,
          'approver_email', approval.approver_email,
          'reason', approval.reason,
          'evidence', approval.evidence
        ) order by approval.created_at)
        from public.payment_route_approvals approval
        where approval.route_id = new.id
          and approval.enablement_request_id = new.active_enablement_request_id
          and approval.approval_kind = 'ENABLE_ROUTE'
      )
    ) else '{}'::jsonb end
  );
  return new;
end
$function$;

create or replace function public.ops_submit_payment_route_enablement_approval(
  p_route_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_reason text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.ops_workforce_principals%rowtype;
  v_route public.payment_routes%rowtype;
  v_request public.payment_route_enablement_requests%rowtype;
  v_email text;
  v_count integer;
  v_enabled boolean := false;
  v_field text;
begin
  if p_route_id is null or p_actor_id is null or length(trim(coalesce(p_reason, ''))) not between 12 and 1000
    or jsonb_typeof(p_evidence) <> 'object' then
    raise exception using errcode = '22023', message = 'Route, named approver, reason and evidence are required';
  end if;
  foreach v_field in array array['collection', 'settlement', 'transfer', 'tailor_withdrawal'] loop
    if length(trim(coalesce(p_evidence ->> v_field, ''))) not between 1 and 500 then
      raise exception using errcode = '22023', message = 'Every required route evidence reference must be provided';
    end if;
  end loop;

  select * into v_actor from public.ops_workforce_principals where id = p_actor_id for share;
  if not found or v_actor.status <> 'ACTIVE' or not ('admin' = any(v_actor.roles))
    or (v_actor.access_review_due_at is not null and v_actor.access_review_due_at <= now()) then
    raise exception using errcode = '42501', message = 'An active, reviewed Ops admin is required';
  end if;

  perform 1 from public.payment_routes where id = p_route_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payment route was not found'; end if;
  select * into v_route from public.payment_routes where id = p_route_id;
  if v_route.status = 'ENABLED' and v_route.active_enablement_request_id is not null
    and (p_request_id is null or p_request_id = v_route.active_enablement_request_id)
    and exists (
      select 1 from public.payment_route_approvals approval
      where approval.route_id = p_route_id
        and approval.enablement_request_id = v_route.active_enablement_request_id
        and approval.approval_kind = 'ENABLE_ROUTE'
        and approval.approver_workforce_principal_id = p_actor_id
    ) then
    return jsonb_build_object('request_id', v_route.active_enablement_request_id, 'route_enabled', true, 'duplicate', true);
  end if;
  if v_route.status <> 'SANDBOX_ONLY' then
    raise exception using errcode = '23514', message = 'Only a sandbox-only route can enter the evidence approval workflow';
  end if;
  if v_route.provider = 'BACHS' and length(trim(coalesce(p_evidence ->> 'provider_confirmation', ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Written Bachs route confirmation reference is required';
  end if;

  if p_request_id is null then
    select * into v_request from public.payment_route_enablement_requests
      where route_id = p_route_id and status = 'OPEN' for update;
    if not found then
      insert into public.payment_route_enablement_requests (route_id, created_by_workforce_principal_id, reason)
      values (p_route_id, p_actor_id, trim(p_reason)) returning * into v_request;
    end if;
  else
    select * into v_request from public.payment_route_enablement_requests
      where id = p_request_id and route_id = p_route_id and status = 'OPEN' for update;
    if not found then raise exception using errcode = 'P0002', message = 'Open route approval request was not found'; end if;
  end if;

  if exists (
    select 1 from public.payment_route_approvals approval
    where approval.route_id = p_route_id and approval.enablement_request_id = v_request.id
      and approval.approval_kind = 'ENABLE_ROUTE'
      and approval.approver_workforce_principal_id = p_actor_id
  ) then
    return jsonb_build_object('request_id', v_request.id, 'route_enabled', false, 'duplicate', true);
  end if;

  v_email := v_actor.email;
  insert into public.payment_route_approvals (
    route_id, enablement_request_id, approver_id, approver_workforce_principal_id,
    approver_email, approval_kind, evidence, reason
  ) values (
    p_route_id, v_request.id, null, p_actor_id, v_email, 'ENABLE_ROUTE', p_evidence, trim(p_reason)
  );

  select count(distinct approval.approver_workforce_principal_id) into v_count
  from public.payment_route_approvals approval
  where approval.route_id = p_route_id and approval.enablement_request_id = v_request.id
    and approval.approval_kind = 'ENABLE_ROUTE';

  perform set_config('app.payment_route_actor_id', p_actor_id::text, true);
  perform set_config('app.payment_route_actor_principal_id', p_actor_id::text, true);
  perform set_config('app.payment_route_change_reason', trim(p_reason), true);
  if v_count >= 2 then
    update public.payment_routes set status = 'ENABLED', active_enablement_request_id = v_request.id
      where id = p_route_id and status = 'SANDBOX_ONLY';
    if not found then raise exception using errcode = '23514', message = 'Route changed before the second approval could be applied'; end if;
    update public.payment_route_enablement_requests set status = 'ENABLED', completed_at = now() where id = v_request.id;
    v_enabled := true;
  end if;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    p_actor_id::text, 'ADMIN', 'ops.payment_route_enablement_approval_submitted', 'warn',
    jsonb_build_object('route_id', p_route_id, 'request_id', v_request.id, 'approval_count', v_count, 'route_enabled', v_enabled, 'reason', trim(p_reason))
  );
  if v_enabled then
    insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
    values (
      p_actor_id::text, 'ADMIN', 'ops.payment_route_enabled', 'warn',
      jsonb_build_object('route_id', p_route_id, 'request_id', v_request.id, 'reason', trim(p_reason))
    );
  end if;
  return jsonb_build_object('request_id', v_request.id, 'route_enabled', v_enabled, 'duplicate', false);
end
$function$;

alter table public.payment_route_enablement_requests enable row level security;
revoke all on public.payment_route_enablement_requests from public, anon, authenticated;
revoke insert, update, delete on public.payment_route_approvals from service_role;
grant select on public.payment_route_enablement_requests, public.payment_route_approvals to service_role;

revoke all on function private.guard_payment_route_enablement_request() from public, anon, authenticated;
revoke all on function private.cancel_open_payment_route_enablement() from public, anon, authenticated;
revoke all on function private.guard_payment_route_change() from public, anon, authenticated;
revoke all on function private.audit_payment_route_change_with_workforce_actor() from public, anon, authenticated;
revoke all on function public.ops_submit_payment_route_enablement_approval(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.guard_payment_route_enablement_request() to service_role;
grant execute on function private.cancel_open_payment_route_enablement() to service_role;
grant execute on function private.guard_payment_route_change() to service_role;
grant execute on function private.audit_payment_route_change_with_workforce_actor() to service_role;
grant execute on function public.ops_submit_payment_route_enablement_approval(uuid, uuid, uuid, text, jsonb) to service_role;
