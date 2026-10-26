-- Phase 2 routing redesign. Additive configuration and one in-place order
-- snapshot extension; no route is enabled and no historical order is backfilled.

create table if not exists public.payment_routes (
  id uuid primary key default gen_random_uuid(),
  route_key text not null,
  version integer not null check (version > 0),
  tailor_country_code text not null check (tailor_country_code ~ '^[A-Z]{2}$'),
  charge_currency text not null check (charge_currency ~ '^[A-Z]{3}$'),
  payout_currency text not null check (payout_currency ~ '^[A-Z]{3}$'),
  provider text not null check (provider in ('STRIPE', 'BACHS')),
  legal_entity text not null check (legal_entity in ('DRAPE_MARKETPLACE_LIMITED', 'O4_GROUP_LLC')),
  status text not null default 'DISABLED'
    check (status in ('DISABLED', 'SANDBOX_ONLY', 'ENABLED')),
  active_enablement_request_id uuid,
  fees_collector text not null check (fees_collector in ('PLATFORM', 'CONNECTED_ACCOUNT')),
  fee_schedule_version text not null,
  confirmed_card_issuer_countries text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (route_key, version),
  unique (id, version),
  check (provider <> 'BACHS' or legal_entity = 'DRAPE_MARKETPLACE_LIMITED'),
  check (provider <> 'STRIPE' or legal_entity = 'O4_GROUP_LLC'),
  check (status <> 'ENABLED' or active_enablement_request_id is not null)
);

create index if not exists payment_routes_exact_match_idx
  on public.payment_routes (tailor_country_code, charge_currency, payout_currency, version desc);

create table if not exists public.delivery_country_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  version integer not null check (version > 0),
  status text not null default 'DISABLED' check (status in ('DISABLED', 'READY')),
  domestic_only boolean not null default false,
  vat_registration_ready boolean not null default false,
  collect_vat_under_gbp_135 boolean not null default false,
  duties_customer_pays boolean not null default false,
  ioss_reviewed boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (country_code, version),
  unique (id, version),
  check (
    status <> 'READY'
    or country_code <> 'GB'
    or (vat_registration_ready and collect_vat_under_gbp_135)
  ),
  check (status <> 'READY' or country_code <> 'US' or duties_customer_pays),
  check (status <> 'READY' or country_code <> 'NG' or domestic_only),
  check (
    status <> 'READY'
    or country_code not in (
      'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
      'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
      'SE', 'SI', 'SK'
    )
    or ioss_reviewed
  )
);

create index if not exists delivery_country_rules_current_idx
  on public.delivery_country_rules (country_code, version desc);

create table if not exists public.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  -- Profile IDs are legacy text identifiers in Dev (and referenced as text in
  -- order snapshots); keep the destination FK on the same canonical type.
  tailor_profile_id text not null references public.tailor_profiles(id) on delete restrict,
  provider text not null check (provider in ('STRIPE', 'BACHS')),
  legal_entity text not null check (legal_entity in ('DRAPE_MARKETPLACE_LIMITED', 'O4_GROUP_LLC')),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_account_ref text not null,
  transfers_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  fees_collector text not null check (fees_collector in ('PLATFORM', 'CONNECTED_ACCOUNT')),
  first_withdrawal_review_status text not null default 'PENDING'
    check (first_withdrawal_review_status in ('PENDING', 'CLEARED', 'BLOCKED')),
  active boolean not null default false,
  capability_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_ref),
  check (provider <> 'BACHS' or legal_entity = 'DRAPE_MARKETPLACE_LIMITED'),
  check (provider <> 'STRIPE' or legal_entity = 'O4_GROUP_LLC'),
  check (
    not active
    or (
      transfers_enabled
      and payouts_enabled
      and first_withdrawal_review_status = 'CLEARED'
      and capability_checked_at is not null
    )
  )
);

create index if not exists payout_destinations_tailor_active_idx
  on public.payout_destinations (tailor_profile_id, provider, country_code, currency)
  where active;

create table if not exists public.payment_route_approvals (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.payment_routes(id) on delete restrict,
  enablement_request_id uuid not null,
  approver_id uuid not null references auth.users(id) on delete restrict,
  approval_kind text not null check (approval_kind = 'ENABLE_ROUTE'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  unique (route_id, enablement_request_id, approval_kind, approver_id)
);

create table if not exists public.payment_route_audit_events (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.payment_routes(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('CREATED', 'STATUS_CHANGED', 'VERSION_CREATED')),
  previous_status text,
  new_status text not null check (new_status in ('DISABLED', 'SANDBOX_ONLY', 'ENABLED')),
  reason text not null check (length(trim(reason)) > 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_country_audit_events (
  id uuid primary key default gen_random_uuid(),
  delivery_country_rule_id uuid not null references public.delivery_country_rules(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  previous_status text,
  new_status text not null check (new_status in ('DISABLED', 'READY')),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists payment_route_id uuid references public.payment_routes(id) on delete restrict,
  add column if not exists payment_route_version integer,
  add column if not exists legal_entity_snapshot text,
  add column if not exists charge_provider_snapshot text,
  add column if not exists charge_currency_snapshot text,
  add column if not exists payout_destination_id uuid references public.payout_destinations(id) on delete restrict,
  add column if not exists fee_schedule_version_snapshot text,
  add column if not exists delivery_country_rule_id uuid references public.delivery_country_rules(id) on delete restrict,
  add column if not exists delivery_country_rule_version integer,
  add column if not exists tax_duty_snapshot jsonb,
  add column if not exists accepted_earning_amount integer,
  add column if not exists tailor_terms_version_snapshot text,
  add column if not exists accepted_route_snapshot_at timestamptz;

alter table public.orders
  add constraint orders_payment_route_version_fk
    foreign key (payment_route_id, payment_route_version)
    references public.payment_routes (id, version) on delete restrict,
  add constraint orders_delivery_country_rule_version_fk
    foreign key (delivery_country_rule_id, delivery_country_rule_version)
    references public.delivery_country_rules (id, version) on delete restrict,
  add constraint orders_payment_route_version_pair_check
    check ((payment_route_id is null) = (payment_route_version is null)),
  add constraint orders_delivery_rule_version_pair_check
    check ((delivery_country_rule_id is null) = (delivery_country_rule_version is null));

alter table public.orders
  add constraint orders_route_snapshot_provider_check
    check (charge_provider_snapshot is null or charge_provider_snapshot in ('STRIPE', 'BACHS')),
  add constraint orders_route_snapshot_entity_check
    check (legal_entity_snapshot is null or legal_entity_snapshot in ('DRAPE_MARKETPLACE_LIMITED', 'O4_GROUP_LLC')),
  add constraint orders_route_snapshot_provider_entity_check
    check (
      charge_provider_snapshot is null
      or (charge_provider_snapshot <> 'BACHS' or legal_entity_snapshot = 'DRAPE_MARKETPLACE_LIMITED')
      and (charge_provider_snapshot <> 'STRIPE' or legal_entity_snapshot = 'O4_GROUP_LLC')
    ),
  add constraint orders_route_snapshot_earning_check
    check (accepted_earning_amount is null or accepted_earning_amount >= 0),
  add constraint orders_route_snapshot_tax_duty_object_check
    check (tax_duty_snapshot is null or jsonb_typeof(tax_duty_snapshot) = 'object'),
  add constraint orders_route_snapshot_complete_check
    check (
      accepted_route_snapshot_at is null
      or (
        payment_route_id is not null
        and payment_route_version is not null
        and legal_entity_snapshot is not null
        and charge_provider_snapshot is not null
        and charge_currency_snapshot is not null
        and payout_destination_id is not null
        and fee_schedule_version_snapshot is not null
        and delivery_country_rule_id is not null
        and delivery_country_rule_version is not null
        and tax_duty_snapshot is not null
        and tailor_payout_currency_locked is not null
        and accepted_earning_amount is not null
        and tailor_terms_version_snapshot is not null
      )
    ),
  add constraint orders_unaccepted_route_snapshot_empty_check
    check (
      accepted_route_snapshot_at is not null
      or (
        payment_route_id is null
        and payment_route_version is null
        and legal_entity_snapshot is null
        and charge_provider_snapshot is null
        and charge_currency_snapshot is null
        and payout_destination_id is null
        and fee_schedule_version_snapshot is null
        and delivery_country_rule_id is null
        and delivery_country_rule_version is null
        and tax_duty_snapshot is null
        and accepted_earning_amount is null
        and tailor_terms_version_snapshot is null
      )
    );

create index if not exists orders_payment_route_snapshot_idx
  on public.orders (payment_route_id, payment_route_version)
  where payment_route_id is not null;

create or replace function private.guard_accepted_payment_route_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_route public.payment_routes%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_delivery_rule public.delivery_country_rules%rowtype;
  v_environment text;
begin
  if new.accepted_route_snapshot_at is not null and (
    tg_op = 'INSERT' or old.accepted_route_snapshot_at is null
  ) then
    if coalesce(current_setting('app.payment_route_snapshot_write', true), '') <> 'on' then
      raise exception using
        errcode = '42501',
        constraint = 'orders_route_snapshot_backend_only',
        message = 'Accepted route snapshots must be written by the canonical acceptance operation';
    end if;

    select * into v_route
    from public.payment_routes as route
    where route.id = new.payment_route_id
      and route.version = new.payment_route_version;
    select * into v_destination
    from public.payout_destinations as destination
    where destination.id = new.payout_destination_id;
    select * into v_delivery_rule
    from public.delivery_country_rules as delivery_rule
    where delivery_rule.id = new.delivery_country_rule_id
      and delivery_rule.version = new.delivery_country_rule_version;
    v_environment := upper(coalesce(current_setting('app.payment_environment', true), ''));

    if v_route.id is null or v_destination.id is null or v_delivery_rule.id is null
      or v_route.status = 'DISABLED'
      or (v_route.status = 'SANDBOX_ONLY' and v_environment <> 'SANDBOX')
      or v_route.provider is distinct from new.charge_provider_snapshot
      or v_route.legal_entity is distinct from new.legal_entity_snapshot
      or v_route.charge_currency is distinct from new.charge_currency_snapshot
      or v_route.payout_currency is distinct from new.tailor_payout_currency_locked::text
      or new.currency::text is distinct from new.charge_currency_snapshot
      or v_route.fee_schedule_version is distinct from new.fee_schedule_version_snapshot
      or v_destination.provider is distinct from v_route.provider
      or v_destination.legal_entity is distinct from v_route.legal_entity
      or v_destination.country_code is distinct from v_route.tailor_country_code
      or v_destination.currency is distinct from v_route.payout_currency
      or v_destination.fees_collector is distinct from v_route.fees_collector
      or v_destination.tailor_profile_id::text is distinct from new.tailor_profile_id::text
      or not v_destination.active
      or not v_destination.transfers_enabled
      or not v_destination.payouts_enabled
      or v_destination.first_withdrawal_review_status <> 'CLEARED'
      or v_delivery_rule.status <> 'READY'
      or v_delivery_rule.country_code is distinct from upper(coalesce(new.delivery_country_code, '')) then
      raise exception using
        errcode = '23514',
        constraint = 'orders_route_snapshot_matches_ready_configuration',
        message = 'Accepted route snapshot does not match one ready route, destination, and delivery rule';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.accepted_route_snapshot_at is not null and (
    new.payment_route_id is distinct from old.payment_route_id
    or new.payment_route_version is distinct from old.payment_route_version
    or new.legal_entity_snapshot is distinct from old.legal_entity_snapshot
    or new.charge_provider_snapshot is distinct from old.charge_provider_snapshot
    or new.charge_currency_snapshot is distinct from old.charge_currency_snapshot
    or new.payout_destination_id is distinct from old.payout_destination_id
    or new.fee_schedule_version_snapshot is distinct from old.fee_schedule_version_snapshot
    or new.delivery_country_rule_id is distinct from old.delivery_country_rule_id
    or new.delivery_country_rule_version is distinct from old.delivery_country_rule_version
    or new.tax_duty_snapshot is distinct from old.tax_duty_snapshot
    or new.accepted_earning_amount is distinct from old.accepted_earning_amount
    or new.tailor_terms_version_snapshot is distinct from old.tailor_terms_version_snapshot
    or new.commercial_policy_version is distinct from old.commercial_policy_version
    or new.accepted_route_snapshot_at is distinct from old.accepted_route_snapshot_at
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'orders_accepted_payment_route_snapshot_immutable',
      message = 'Accepted payment route snapshot is immutable';
  end if;
  return new;
end
$function$;

drop trigger if exists orders_accepted_payment_route_snapshot_immutable on public.orders;
create trigger orders_accepted_payment_route_snapshot_immutable
before insert or update on public.orders
for each row
execute function private.guard_accepted_payment_route_snapshot();

revoke all on function private.guard_accepted_payment_route_snapshot() from public, anon, authenticated;
grant execute on function private.guard_accepted_payment_route_snapshot() to service_role;

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
      raise exception using
        errcode = '23514',
        constraint = 'payment_routes_created_disabled',
        message = 'Payment routes must be created disabled';
    end if;
    v_actor_id := coalesce(
      auth.uid(),
      nullif(current_setting('app.payment_route_actor_id', true), '')::uuid
    );
    v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
    if v_actor_id is null or v_reason is null then
      raise exception using
        errcode = '23514',
        constraint = 'payment_routes_creation_audited',
        message = 'Route creation requires an actor and reason';
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
    raise exception using
      errcode = '23514',
      constraint = 'payment_routes_versioned_config_immutable',
      message = 'Payment route configuration is immutable; create a new version';
  end if;

  if new.status is distinct from old.status then
    v_actor_id := coalesce(
      auth.uid(),
      nullif(current_setting('app.payment_route_actor_id', true), '')::uuid
    );
    v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
    if v_actor_id is null or v_reason is null then
      raise exception using
        errcode = '23514',
        constraint = 'payment_routes_status_change_audited',
        message = 'Route status changes require an actor and reason';
    end if;

    if new.status = 'ENABLED' then
      if new.active_enablement_request_id is null then
        raise exception using
          errcode = '23514',
          constraint = 'payment_routes_enablement_request_required',
          message = 'Route enablement requires a new approval request';
      end if;

      select count(distinct approval.approver_id),
        coalesce(bool_and(
          nullif(trim(approval.evidence ->> 'collection'), '') is not null
          and nullif(trim(approval.evidence ->> 'settlement'), '') is not null
          and nullif(trim(approval.evidence ->> 'transfer'), '') is not null
          and nullif(trim(approval.evidence ->> 'tailor_withdrawal'), '') is not null
          and (
            new.provider <> 'BACHS'
            or nullif(trim(approval.evidence ->> 'provider_confirmation'), '') is not null
          )
        ), false)
      into v_approver_count, v_evidence_complete
      from public.payment_route_approvals as approval
      where approval.route_id = new.id
        and approval.enablement_request_id = new.active_enablement_request_id
        and approval.approval_kind = 'ENABLE_ROUTE';

      if v_approver_count < 2 or not v_evidence_complete then
        raise exception using
          errcode = '23514',
          constraint = 'payment_routes_two_approver_evidence_required',
          message = 'Route enablement requires two distinct approvers and all route evidence';
      end if;
    else
      new.active_enablement_request_id := null;
    end if;

    new.updated_at := now();
  elsif new.active_enablement_request_id is distinct from old.active_enablement_request_id then
    raise exception using
      errcode = '23514',
      constraint = 'payment_routes_request_changes_with_status',
      message = 'Route approval request can change only with an audited status change';
  elsif new.updated_at is distinct from old.updated_at then
    raise exception using
      errcode = '23514',
      constraint = 'payment_routes_updated_at_managed',
      message = 'Route update timestamp is managed by the database';
  end if;

  return new;
end
$function$;

create or replace function private.audit_payment_route_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_actor_id := coalesce(
      auth.uid(),
      nullif(current_setting('app.payment_route_actor_id', true), '')::uuid
    );
    v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
    insert into public.payment_route_audit_events (
      route_id, actor_id, action, new_status, reason
    ) values (new.id, v_actor_id, 'CREATED', new.status, v_reason);
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_actor_id := coalesce(
    auth.uid(),
    nullif(current_setting('app.payment_route_actor_id', true), '')::uuid
  );
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
  insert into public.payment_route_audit_events (
    route_id, actor_id, action, previous_status, new_status, reason,
    evidence
  ) values (
    new.id, v_actor_id, 'STATUS_CHANGED', old.status, new.status, v_reason,
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

create trigger payment_routes_audit_guard
before insert or update on public.payment_routes
for each row
execute function private.guard_payment_route_change();

create trigger payment_routes_audit_event
after insert or update on public.payment_routes
for each row
execute function private.audit_payment_route_change();

create or replace function private.guard_payout_destination_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.tailor_profile_id is distinct from old.tailor_profile_id
    or new.provider is distinct from old.provider
    or new.legal_entity is distinct from old.legal_entity
    or new.country_code is distinct from old.country_code
    or new.currency is distinct from old.currency
    or new.provider_account_ref is distinct from old.provider_account_ref
    or new.fees_collector is distinct from old.fees_collector then
    raise exception using
      errcode = '23514',
      constraint = 'payout_destination_identity_immutable',
      message = 'Payout destination identity and fee collector are immutable';
  end if;
  if new.transfers_enabled is distinct from old.transfers_enabled
    or new.payouts_enabled is distinct from old.payouts_enabled
    or new.first_withdrawal_review_status is distinct from old.first_withdrawal_review_status
    or new.active is distinct from old.active then
    if new.capability_checked_at is null
      or new.capability_checked_at is not distinct from old.capability_checked_at then
      raise exception using
        errcode = '23514',
        constraint = 'payout_destination_capability_check_required',
        message = 'Destination capability and first-withdrawal state require a fresh check';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$function$;

create trigger payout_destination_identity_immutable
before update on public.payout_destinations
for each row
execute function private.guard_payout_destination_identity();

create or replace function private.guard_delivery_country_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DISABLED' then
      raise exception using
        errcode = '23514',
        constraint = 'delivery_country_rules_created_disabled',
        message = 'Delivery-country rules must be created disabled';
    end if;
    v_actor_id := coalesce(
      auth.uid(),
      nullif(current_setting('app.payment_route_actor_id', true), '')::uuid
    );
    v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
    if v_actor_id is null or v_reason is null then
      raise exception using
        errcode = '23514',
        constraint = 'delivery_country_rules_creation_audited',
        message = 'Delivery-country rule creation requires an actor and reason';
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
    raise exception using
      errcode = '23514',
      constraint = 'delivery_country_rules_versioned_config_immutable',
      message = 'Delivery-country rule is immutable; create a new version';
  end if;
  if new.status is distinct from old.status then
    v_actor_id := coalesce(
      auth.uid(),
      nullif(current_setting('app.payment_route_actor_id', true), '')::uuid
    );
    v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
    if v_actor_id is null or v_reason is null then
      raise exception using
        errcode = '23514',
        constraint = 'delivery_country_rules_status_change_audited',
        message = 'Delivery-country status changes require an actor and reason';
    end if;
    new.updated_at := now();
  elsif new.updated_at is distinct from old.updated_at then
    raise exception using
      errcode = '23514',
      constraint = 'delivery_country_rules_updated_at_managed',
      message = 'Delivery-country rule update timestamp is managed by the database';
  end if;
  return new;
end
$function$;

create or replace function private.audit_delivery_country_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_reason text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_actor_id := coalesce(
    auth.uid(),
    nullif(current_setting('app.payment_route_actor_id', true), '')::uuid
  );
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');
  insert into public.delivery_country_audit_events (
    delivery_country_rule_id, actor_id, previous_status, new_status, reason
  ) values (
    new.id, v_actor_id, case when tg_op = 'UPDATE' then old.status else null end,
    new.status, v_reason
  );
  return new;
end
$function$;

create trigger delivery_country_rules_audit_guard
before insert or update on public.delivery_country_rules
for each row
execute function private.guard_delivery_country_rule_change();

create trigger delivery_country_rules_audit_event
after insert or update on public.delivery_country_rules
for each row
execute function private.audit_delivery_country_rule_change();

revoke all on function private.guard_payment_route_change() from public, anon, authenticated;
revoke all on function private.audit_payment_route_change() from public, anon, authenticated;
revoke all on function private.guard_payout_destination_identity() from public, anon, authenticated;
revoke all on function private.guard_delivery_country_rule_change() from public, anon, authenticated;
revoke all on function private.audit_delivery_country_rule_change() from public, anon, authenticated;
grant execute on function private.guard_payment_route_change() to service_role;
grant execute on function private.audit_payment_route_change() to service_role;
grant execute on function private.guard_payout_destination_identity() to service_role;
grant execute on function private.guard_delivery_country_rule_change() to service_role;
grant execute on function private.audit_delivery_country_rule_change() to service_role;

alter table public.payment_routes enable row level security;
alter table public.delivery_country_rules enable row level security;
alter table public.payout_destinations enable row level security;
alter table public.payment_route_approvals enable row level security;
alter table public.payment_route_audit_events enable row level security;
alter table public.delivery_country_audit_events enable row level security;

revoke all on public.payment_routes, public.delivery_country_rules, public.payout_destinations,
  public.payment_route_approvals, public.payment_route_audit_events,
  public.delivery_country_audit_events from public, anon, authenticated;
revoke update, delete on public.payment_route_approvals, public.payment_route_audit_events,
  public.delivery_country_audit_events from service_role;
revoke delete on public.payment_routes, public.delivery_country_rules,
  public.payout_destinations from service_role;
grant select, insert, update on public.payment_routes, public.delivery_country_rules,
  public.payout_destinations to service_role;
grant select, insert on public.payment_route_approvals, public.payment_route_audit_events,
  public.delivery_country_audit_events to service_role;
