begin;

do $guard$
begin
  if exists (select 1 from public.payment_route_enablement_requests) then
    raise exception 'Cannot roll back route enablement after an approval request has been recorded; retain the audit history and roll forward instead.';
  end if;
end
$guard$;

drop trigger if exists payment_routes_cancel_open_enablement on public.payment_routes;
drop trigger if exists payment_route_enablement_request_guard on public.payment_route_enablement_requests;
drop function if exists private.cancel_open_payment_route_enablement();
drop function if exists private.guard_payment_route_enablement_request();
drop function if exists public.ops_submit_payment_route_enablement_approval(uuid, uuid, uuid, text, jsonb);

drop index if exists public.payment_route_approvals_auth_actor_unique;
drop index if exists public.payment_route_approvals_workforce_actor_unique;
alter table public.payment_route_approvals
  drop constraint if exists payment_route_approvals_request_fk,
  drop constraint if exists payment_route_approvals_exactly_one_approver_check,
  drop column if exists approver_workforce_principal_id,
  drop column if exists approver_email,
  alter column approver_id set not null,
  add constraint payment_route_approvals_route_id_enablement_request_id_appr_key
    unique (route_id, enablement_request_id, approval_kind, approver_id);
drop table if exists public.payment_route_enablement_requests;

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

  if new.id is distinct from old.id or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by or new.route_key is distinct from old.route_key
    or new.version is distinct from old.version or new.tailor_country_code is distinct from old.tailor_country_code
    or new.charge_currency is distinct from old.charge_currency or new.payout_currency is distinct from old.payout_currency
    or new.provider is distinct from old.provider or new.legal_entity is distinct from old.legal_entity
    or new.fees_collector is distinct from old.fees_collector or new.fee_schedule_version is distinct from old.fee_schedule_version
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
      if new.active_enablement_request_id is null then
        raise exception using errcode = '23514', constraint = 'payment_routes_enablement_request_required', message = 'Route enablement requires a new approval request';
      end if;
      select count(distinct approval.approver_id), coalesce(bool_and(
        nullif(trim(approval.evidence ->> 'collection'), '') is not null
        and nullif(trim(approval.evidence ->> 'settlement'), '') is not null
        and nullif(trim(approval.evidence ->> 'transfer'), '') is not null
        and nullif(trim(approval.evidence ->> 'tailor_withdrawal'), '') is not null
        and (new.provider <> 'BACHS' or nullif(trim(approval.evidence ->> 'provider_confirmation'), '') is not null)
      ), false)
      into v_approver_count, v_evidence_complete
      from public.payment_route_approvals approval
      where approval.route_id = new.id and approval.enablement_request_id = new.active_enablement_request_id
        and approval.approval_kind = 'ENABLE_ROUTE';
      if v_approver_count < 2 or not v_evidence_complete then
        raise exception using errcode = '23514', constraint = 'payment_routes_two_approver_evidence_required', message = 'Route enablement requires two distinct approvers and all route evidence';
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
      'approvals', (select jsonb_agg(jsonb_build_object('approver_id', approval.approver_id, 'evidence', approval.evidence))
        from public.payment_route_approvals approval where approval.route_id = new.id
          and approval.enablement_request_id = new.active_enablement_request_id and approval.approval_kind = 'ENABLE_ROUTE')
    ) else '{}'::jsonb end
  );
  return new;
end
$function$;

revoke all on function private.guard_payment_route_change() from public, anon, authenticated;
revoke all on function private.audit_payment_route_change_with_workforce_actor() from public, anon, authenticated;
grant execute on function private.guard_payment_route_change() to service_role;
grant execute on function private.audit_payment_route_change_with_workforce_actor() to service_role;
grant select, insert on public.payment_route_approvals to service_role;

commit;
