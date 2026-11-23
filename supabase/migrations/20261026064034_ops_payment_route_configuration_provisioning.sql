-- Audited, immutable provisioning for the small Phase 2 route/country matrix.
-- All newly provisioned rows start DISABLED. No function here enables checkout.

-- The route guard predates named workforce Ops principals. Preserve
-- auth.users.created_by for Supabase-auth actors while allowing the audit
-- trigger to attribute service-role Ops mutations to the workforce principal.
create or replace function private.guard_payment_route_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_workforce_actor_id uuid;
  v_reason text;
  v_approver_count integer;
  v_evidence_complete boolean;
begin
  v_actor_id := auth.uid();
  v_workforce_actor_id := nullif(current_setting('app.payment_route_actor_principal_id', true), '')::uuid;
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');

  if tg_op = 'INSERT' then
    if new.status <> 'DISABLED' or new.active_enablement_request_id is not null then
      raise exception using errcode = '23514', constraint = 'payment_routes_created_disabled', message = 'Payment routes must be created disabled';
    end if;
    if (v_actor_id is null and v_workforce_actor_id is null) or v_reason is null then
      raise exception using errcode = '23514', constraint = 'payment_routes_creation_audited', message = 'Route creation requires a named actor and reason';
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
    if (v_actor_id is null and v_workforce_actor_id is null) or v_reason is null then
      raise exception using errcode = '23514', constraint = 'payment_routes_status_change_audited', message = 'Route status changes require a named actor and reason';
    end if;
    if new.status = 'ENABLED' then
      if new.active_enablement_request_id is null or not exists (
        select 1 from public.payment_route_enablement_requests as request
        where request.id = new.active_enablement_request_id
          and request.route_id = new.id and request.status = 'OPEN'
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
      from public.payment_route_approvals as approval
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

revoke all on function private.guard_payment_route_change() from public, anon, authenticated;
grant execute on function private.guard_payment_route_change() to service_role;

create or replace function private.guard_delivery_country_rule_change()
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
  v_actor_id := auth.uid();
  v_workforce_actor_id := nullif(current_setting('app.payment_route_actor_principal_id', true), '')::uuid;
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
  if tg_op = 'INSERT' then
    if new.status <> 'DISABLED' then
      raise exception using errcode = '23514', constraint = 'delivery_country_rules_created_disabled', message = 'Delivery-country rules must be created disabled';
    end if;
    if (v_actor_id is null and v_workforce_actor_id is null) or v_reason is null then
      raise exception using errcode = '23514', constraint = 'delivery_country_rules_creation_audited', message = 'Delivery-country rule creation requires a named actor and reason';
    end if;
    new.created_by := coalesce(new.created_by, v_actor_id);
    return new;
  end if;

  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
    or new.country_code is distinct from old.country_code
    or new.version is distinct from old.version
    or new.domestic_only is distinct from old.domestic_only
    or new.vat_registration_ready is distinct from old.vat_registration_ready
    or new.collect_vat_under_gbp_135 is distinct from old.collect_vat_under_gbp_135
    or new.duties_customer_pays is distinct from old.duties_customer_pays
    or new.ioss_reviewed is distinct from old.ioss_reviewed
    or new.config is distinct from old.config then
    raise exception using errcode = '23514', constraint = 'delivery_country_rules_versioned_config_immutable', message = 'Delivery-country rule is immutable; create a new version';
  end if;
  if new.status is distinct from old.status then
    if (v_actor_id is null and v_workforce_actor_id is null) or v_reason is null then
      raise exception using errcode = '23514', constraint = 'delivery_country_rules_status_change_audited', message = 'Delivery-country status changes require a named actor and reason';
    end if;
    new.updated_at := now();
  elsif new.updated_at is distinct from old.updated_at then
    raise exception using errcode = '23514', constraint = 'delivery_country_rules_updated_at_managed', message = 'Delivery-country rule update timestamp is managed by the database';
  end if;
  return new;
end
$function$;

revoke all on function private.guard_delivery_country_rule_change() from public, anon, authenticated;
grant execute on function private.guard_delivery_country_rule_change() to service_role;

create or replace function public.ops_create_phase2_payment_route(
  p_actor_principal_id uuid,
  p_route_key text,
  p_version integer,
  p_tailor_country_code text,
  p_charge_currency text,
  p_payout_currency text,
  p_provider text,
  p_legal_entity text,
  p_fee_schedule_version text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_route_id uuid;
  v_existing public.payment_routes%rowtype;
  v_route_key text := lower(trim(coalesce(p_route_key, '')));
  v_tailor_country text := upper(trim(coalesce(p_tailor_country_code, '')));
  v_charge_currency text := upper(trim(coalesce(p_charge_currency, '')));
  v_payout_currency text := upper(trim(coalesce(p_payout_currency, '')));
  v_provider text := upper(trim(coalesce(p_provider, '')));
  v_legal_entity text := upper(trim(coalesce(p_legal_entity, '')));
  v_fee_schedule text := lower(trim(coalesce(p_fee_schedule_version, '')));
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if p_actor_principal_id is null
    or length(v_reason) not between 12 and 1000
    or p_version is distinct from 1
    or v_route_key not in ('ng-ngn-ngn-bachs', 'us-usd-usd-stripe')
    or v_provider not in ('BACHS', 'STRIPE')
    or v_legal_entity not in ('DRAPE_MARKETPLACE_LIMITED', 'O4_GROUP_LLC')
    or v_fee_schedule <> 'customer-disclosed-provider-costs-v1' then
    raise exception using errcode = '22023', message = 'Phase 2 route configuration is invalid';
  end if;

  if not exists (
    select 1 from public.ops_workforce_principals as principal
    where principal.id = p_actor_principal_id
      and principal.status = 'ACTIVE'
      and 'admin' = any(principal.roles)
  ) then
    raise exception using errcode = '42501', message = 'An active named Ops admin is required';
  end if;

  if not (
    (v_route_key = 'ng-ngn-ngn-bachs'
      and v_tailor_country = 'NG' and v_charge_currency = 'NGN'
      and v_payout_currency = 'NGN' and v_provider = 'BACHS'
      and v_legal_entity = 'DRAPE_MARKETPLACE_LIMITED')
    or
    (v_route_key = 'us-usd-usd-stripe'
      and v_tailor_country = 'US' and v_charge_currency = 'USD'
      and v_payout_currency = 'USD' and v_provider = 'STRIPE'
      and v_legal_entity = 'O4_GROUP_LLC')
  ) then
    raise exception using errcode = '22023', message = 'Route corridor does not match an approved Phase 2 template';
  end if;

  select * into v_existing
  from public.payment_routes
  where route_key = v_route_key and version = p_version;
  if found then
    if v_existing.tailor_country_code = v_tailor_country
      and v_existing.charge_currency = v_charge_currency
      and v_existing.payout_currency = v_payout_currency
      and v_existing.provider = v_provider
      and v_existing.legal_entity = v_legal_entity
      and v_existing.fees_collector = 'PLATFORM'
      and v_existing.fee_schedule_version = v_fee_schedule then
      return v_existing.id;
    end if;
    raise exception using errcode = '23505', message = 'Route version already exists with different immutable configuration';
  end if;

  perform set_config('app.payment_route_actor_principal_id', p_actor_principal_id::text, true);
  perform set_config('app.payment_route_change_reason', v_reason, true);

  insert into public.payment_routes (
    route_key, version, tailor_country_code, charge_currency, payout_currency,
    provider, legal_entity, status, fees_collector, fee_schedule_version,
    confirmed_card_issuer_countries
  ) values (
    v_route_key, p_version, v_tailor_country, v_charge_currency, v_payout_currency,
    v_provider, v_legal_entity, 'DISABLED', 'PLATFORM', v_fee_schedule,
    '{}'::text[]
  ) returning id into v_route_id;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    p_actor_principal_id::text,
    'ADMIN',
    'ops.payment_route_config_created',
    'notice',
    jsonb_build_object('route_id', v_route_id, 'route_key', v_route_key, 'version', p_version, 'reason', v_reason)
  );
  return v_route_id;
end
$function$;

create or replace function public.ops_create_phase2_delivery_country_rule(
  p_actor_principal_id uuid,
  p_country_code text,
  p_version integer,
  p_domestic_only boolean,
  p_vat_registration_ready boolean,
  p_collect_vat_under_gbp_135 boolean,
  p_duties_customer_pays boolean,
  p_ioss_reviewed boolean,
  p_evidence_reference text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rule_id uuid;
  v_existing public.delivery_country_rules%rowtype;
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_evidence_reference text := trim(coalesce(p_evidence_reference, ''));
  v_reason text := trim(coalesce(p_reason, ''));
  v_allowed_countries text[] := array[
    'GB','US','NG','AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR',
    'HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK'
  ]::text[];
begin
  if p_actor_principal_id is null
    or length(v_reason) not between 12 and 1000
    or p_version is distinct from 1
    or not (v_country = any(v_allowed_countries)) then
    raise exception using errcode = '22023', message = 'Phase 2 delivery-country configuration is invalid';
  end if;

  if not exists (
    select 1 from public.ops_workforce_principals as principal
    where principal.id = p_actor_principal_id
      and principal.status = 'ACTIVE'
      and 'admin' = any(principal.roles)
  ) then
    raise exception using errcode = '42501', message = 'An active named Ops admin is required';
  end if;

  if (v_country = 'GB' and (p_domestic_only or p_duties_customer_pays or p_ioss_reviewed))
    or (v_country = 'US' and (p_domestic_only or p_vat_registration_ready or p_collect_vat_under_gbp_135 or p_ioss_reviewed or not p_duties_customer_pays))
    or (v_country = 'NG' and (p_vat_registration_ready or p_collect_vat_under_gbp_135 or p_duties_customer_pays or p_ioss_reviewed or not p_domestic_only))
    or (v_country <> all(array['GB','US','NG']::text[]) and (p_domestic_only or p_vat_registration_ready or p_collect_vat_under_gbp_135 or p_duties_customer_pays))
    or ((p_vat_registration_ready or p_collect_vat_under_gbp_135 or p_ioss_reviewed) and length(v_evidence_reference) not between 1 and 500) then
    raise exception using errcode = '22023', message = 'Delivery-country flags do not match the approved country rule';
  end if;

  select * into v_existing
  from public.delivery_country_rules
  where country_code = v_country and version = p_version;
  if found then
    if v_existing.domestic_only = p_domestic_only
      and v_existing.vat_registration_ready = p_vat_registration_ready
      and v_existing.collect_vat_under_gbp_135 = p_collect_vat_under_gbp_135
      and v_existing.duties_customer_pays = p_duties_customer_pays
      and v_existing.ioss_reviewed = p_ioss_reviewed
      and v_existing.config ->> 'evidence_reference' is not distinct from nullif(v_evidence_reference, '') then
      return v_existing.id;
    end if;
    raise exception using errcode = '23505', message = 'Delivery-country version already exists with different immutable configuration';
  end if;

  perform set_config('app.payment_route_actor_principal_id', p_actor_principal_id::text, true);
  perform set_config('app.payment_route_change_reason', v_reason, true);

  insert into public.delivery_country_rules (
    country_code, version, status, domestic_only, vat_registration_ready,
    collect_vat_under_gbp_135, duties_customer_pays, ioss_reviewed, config
  ) values (
    v_country, p_version, 'DISABLED', p_domestic_only, p_vat_registration_ready,
    p_collect_vat_under_gbp_135, p_duties_customer_pays, p_ioss_reviewed,
    case when v_evidence_reference = ''
      then jsonb_build_object('provisioned_by', 'ops_phase2_config')
      else jsonb_build_object('provisioned_by', 'ops_phase2_config', 'evidence_reference', v_evidence_reference)
    end
  ) returning id into v_rule_id;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    p_actor_principal_id::text,
    'ADMIN',
    'ops.delivery_country_config_created',
    'notice',
    jsonb_build_object('delivery_country_rule_id', v_rule_id, 'country_code', v_country, 'version', p_version, 'reason', v_reason)
  );
  return v_rule_id;
end
$function$;

create or replace function public.ops_mark_payment_route_sandbox_only(
  p_route_id uuid,
  p_actor_principal_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_route public.payment_routes%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if p_route_id is null or p_actor_principal_id is null or length(v_reason) not between 12 and 1000 then
    raise exception using errcode = '22023', message = 'Route, named admin, and reason are required';
  end if;
  if not exists (
    select 1 from public.ops_workforce_principals as principal
    where principal.id = p_actor_principal_id
      and principal.status = 'ACTIVE'
      and 'admin' = any(principal.roles)
  ) then
    raise exception using errcode = '42501', message = 'An active named Ops admin is required';
  end if;

  select * into v_route from public.payment_routes where id = p_route_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payment route was not found';
  end if;
  if v_route.status = 'SANDBOX_ONLY' then return; end if;
  if v_route.status <> 'DISABLED' then
    raise exception using errcode = '23514', message = 'Only a disabled route can move to sandbox-only';
  end if;

  perform set_config('app.payment_route_actor_principal_id', p_actor_principal_id::text, true);
  perform set_config('app.payment_route_change_reason', v_reason, true);
  update public.payment_routes set status = 'SANDBOX_ONLY' where id = p_route_id;
  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    p_actor_principal_id::text,
    'ADMIN',
    'ops.payment_route_sandbox_only',
    'notice',
    jsonb_build_object('route_id', p_route_id, 'reason', v_reason)
  );
end
$function$;

revoke all on function public.ops_create_phase2_payment_route(uuid,text,integer,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.ops_create_phase2_delivery_country_rule(uuid,text,integer,boolean,boolean,boolean,boolean,boolean,text,text) from public, anon, authenticated;
revoke all on function public.ops_mark_payment_route_sandbox_only(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.ops_create_phase2_payment_route(uuid,text,integer,text,text,text,text,text,text,text) to service_role;
grant execute on function public.ops_create_phase2_delivery_country_rule(uuid,text,integer,boolean,boolean,boolean,boolean,boolean,text,text) to service_role;
grant execute on function public.ops_mark_payment_route_sandbox_only(uuid,uuid,text) to service_role;
