-- Drapeon lifecycle surveys: durable eligibility scheduling.
--
-- Domain tables remain authoritative. These triggers only create private,
-- idempotent invite records after an eligible transition; they do not send
-- email, create analytics, or block the order/support/payout transaction.

create table if not exists public.survey_invites (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'CUSTOMER_POST_COMPLETION_CSAT',
    'SUPPORT_RESOLUTION_CSAT',
    'TAILOR_FIRST_ORDER_CSAT',
    'ONBOARDING_PULSE'
  )),
  version integer not null default 1 check (version = 1),
  subject_type text not null check (subject_type in ('ORDER', 'SUPPORT_CASE', 'ACCOUNT')),
  subject_id text not null check (char_length(trim(subject_id)) between 1 and 120),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('CUSTOMER', 'TAILOR')),
  channel text not null default 'EMAIL' check (channel in ('WEB', 'IOS', 'ANDROID', 'EMAIL')),
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'COMPLETED', 'SUPPRESSED', 'EXPIRED')),
  available_at timestamptz not null,
  expires_at timestamptz not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  survey_response_id uuid references public.survey_responses(id) on delete set null,
  sent_at timestamptz,
  completed_at timestamptz,
  suppressed_at timestamptz,
  suppressed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, version, subject_type, subject_id),
  check (expires_at > available_at),
  check (status <> 'SENT' or sent_at is not null),
  check (status <> 'COMPLETED' or completed_at is not null),
  check (status <> 'SUPPRESSED' or suppressed_at is not null)
);

create index if not exists survey_invites_due_idx
  on public.survey_invites (status, available_at, created_at)
  where status = 'PENDING';

create index if not exists survey_invites_user_idx
  on public.survey_invites (user_id, created_at desc);

create or replace function public.set_survey_invite_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_survey_invites_updated_at on public.survey_invites;
create trigger trg_survey_invites_updated_at
before update on public.survey_invites
for each row execute function public.set_survey_invite_updated_at();

create or replace function public.enqueue_survey_invite(
  p_kind text,
  p_subject_type text,
  p_subject_id text,
  p_user_id uuid,
  p_channel text default 'EMAIL',
  p_available_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_kind text := upper(trim(coalesce(p_kind, '')));
  v_subject_type text := upper(trim(coalesce(p_subject_type, '')));
  v_subject_id text := trim(coalesce(p_subject_id, ''));
  v_channel text := upper(trim(coalesce(p_channel, 'EMAIL')));
  v_role text;
  v_key text;
  v_available_at timestamptz := coalesce(p_available_at, now());
  v_invite_id uuid;
begin
  if v_kind not in (
    'CUSTOMER_POST_COMPLETION_CSAT',
    'SUPPORT_RESOLUTION_CSAT',
    'TAILOR_FIRST_ORDER_CSAT',
    'ONBOARDING_PULSE'
  ) then
    raise exception 'Unsupported survey kind.' using errcode = '22023';
  end if;
  if v_subject_type not in ('ORDER', 'SUPPORT_CASE', 'ACCOUNT') then
    raise exception 'Unsupported survey subject type.' using errcode = '22023';
  end if;
  if v_subject_id = '' or char_length(v_subject_id) > 120 then
    raise exception 'Survey subject id is invalid.' using errcode = '22023';
  end if;
  if v_channel not in ('WEB', 'IOS', 'ANDROID', 'EMAIL') then
    raise exception 'Unsupported survey invite channel.' using errcode = '22023';
  end if;
  if p_user_id is null then
    return null;
  end if;

  select upper(coalesce(u.role::text, au.raw_user_meta_data->>'role', ''))
    into v_role
  from auth.users au
  left join public.users u on u.id = au.id
  where au.id = p_user_id;

  if v_role not in ('CUSTOMER', 'TAILOR') then
    return null;
  end if;
  if v_kind = 'CUSTOMER_POST_COMPLETION_CSAT'
    and (v_subject_type <> 'ORDER' or v_role <> 'CUSTOMER') then
    return null;
  end if;
  if v_kind = 'TAILOR_FIRST_ORDER_CSAT'
    and (v_subject_type <> 'ORDER' or v_role <> 'TAILOR') then
    return null;
  end if;
  if v_kind = 'SUPPORT_RESOLUTION_CSAT' and v_subject_type <> 'SUPPORT_CASE' then
    return null;
  end if;
  if v_kind = 'ONBOARDING_PULSE' and v_subject_type <> 'ACCOUNT' then
    return null;
  end if;

  -- A response is terminal for this subject. Do not leave a stale invite that
  -- could be delivered after a user has already completed the survey.
  if exists (
    select 1
    from public.survey_responses sr
    where sr.user_id = p_user_id
      and sr.kind = v_kind
      and sr.version = 1
      and sr.subject_type = v_subject_type
      and sr.subject_id = v_subject_id
  ) then
    return null;
  end if;

  v_key := 'survey-invite:' || lower(v_kind) || ':' || p_user_id::text || ':'
    || lower(v_subject_type) || ':' || v_subject_id || ':v1';

  insert into public.survey_invites (
    kind,
    version,
    subject_type,
    subject_id,
    user_id,
    role,
    channel,
    status,
    available_at,
    expires_at,
    idempotency_key,
    metadata
  ) values (
    v_kind,
    1,
    v_subject_type,
    v_subject_id,
    p_user_id,
    v_role,
    v_channel,
    'PENDING',
    v_available_at,
    v_available_at + interval '30 days',
    v_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_invite_id;

  if v_invite_id is null then
    select id into v_invite_id
    from public.survey_invites
    where idempotency_key = v_key;
  end if;
  return v_invite_id;
exception when others then
  -- Feedback scheduling is a side effect. A schema/provider hiccup must never
  -- make an order, support, or payout transition fail.
  raise warning 'Drapeon survey invite enqueue failed for %/%: %', v_kind, v_subject_id, sqlerrm;
  return null;
end;
$$;

create or replace function public.schedule_customer_completion_survey()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.stage::text = 'COMPLETE'
    and (tg_op = 'INSERT' or old.stage::text is distinct from 'COMPLETE') then
    perform public.enqueue_survey_invite(
      'CUSTOMER_POST_COMPLETION_CSAT',
      'ORDER',
      new.id_text,
      new.customer_id,
      'EMAIL',
      coalesce(new.stage_updated_at, new.updated_at, now()) + interval '24 hours',
      jsonb_build_object('source', 'orders.stage', 'stage', 'COMPLETE')
    );
  end if;
  return new;
exception when others then
  raise warning 'Drapeon customer survey scheduling failed for order %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_schedule_customer_completion_survey on public.orders;
create trigger trg_schedule_customer_completion_survey
after insert or update of stage on public.orders
for each row execute function public.schedule_customer_completion_survey();

create or replace function public.schedule_support_resolution_survey()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_now_resolved boolean;
  v_was_resolved boolean := false;
begin
  if new.issue_type = 'ACCOUNT_DELETION_REQUEST'
    or new.user_id is null
    or new.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  v_now_resolved := new.status = 'RESOLVED'
    or new.canonical_status in ('RESOLVED', 'CLOSED');
  if tg_op = 'UPDATE' then
    v_was_resolved := old.status = 'RESOLVED'
      or old.canonical_status in ('RESOLVED', 'CLOSED');
  end if;
  if not v_now_resolved or v_was_resolved then
    return new;
  end if;

  v_user_id := new.user_id::uuid;
  perform public.enqueue_survey_invite(
    'SUPPORT_RESOLUTION_CSAT',
    'SUPPORT_CASE',
    new.id::text,
    v_user_id,
    'EMAIL',
    coalesce(new.resolved_at, new.closed_at, new.updated_at, now()) + interval '2 hours',
    jsonb_build_object('source', 'ops_issues.resolution', 'status', 'RESOLVED')
  );
  return new;
exception when others then
  raise warning 'Drapeon support survey scheduling failed for case %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_schedule_support_resolution_survey on public.ops_issues;
create trigger trg_schedule_support_resolution_survey
after insert or update of status, canonical_status, resolved_at, closed_at on public.ops_issues
for each row execute function public.schedule_support_resolution_survey();

create or replace function public.schedule_tailor_first_order_survey()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_profile_user_id uuid;
  v_tailor_id uuid;
  v_first_completed_order_id text;
  v_provider_confirmed boolean;
begin
  if new.payout_purpose not in ('ORDER_EARNING', 'SETTLEMENT_TRANCHE') then
    return new;
  end if;
  v_provider_confirmed := new.status::text = 'PAID'
    or new.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
    or new.bank_settlement_status = 'PAID';
  if not v_provider_confirmed or new.order_id is null then
    return new;
  end if;

  select o.*
    into v_order
  from public.orders o
  where o.id::text = new.order_id::text
    and o.stage::text = 'COMPLETE'
  limit 1;
  if v_order.id is null then
    return new;
  end if;

  select tp.user_id
    into v_profile_user_id
  from public.tailor_profiles tp
  where tp.id = v_order.tailor_profile_id;

  v_tailor_id := coalesce(v_order.tailor_id, v_profile_user_id);
  if v_tailor_id is null then
    return new;
  end if;

  select o.id_text
    into v_first_completed_order_id
  from public.orders o
  left join public.tailor_profiles tp on tp.id = o.tailor_profile_id
  where o.stage::text = 'COMPLETE'
    and (o.tailor_id = v_tailor_id or tp.user_id = v_tailor_id)
  order by o.created_at asc, o.id asc
  limit 1;

  if v_first_completed_order_id is distinct from v_order.id_text then
    return new;
  end if;

  perform public.enqueue_survey_invite(
    'TAILOR_FIRST_ORDER_CSAT',
    'ORDER',
    v_order.id_text,
    v_tailor_id,
    'EMAIL',
    coalesce(new.completed_at, new.processed_at, now()) + interval '24 hours',
    jsonb_build_object(
      'source', 'payout.provider_confirmation',
      'provider_transfer_status', new.provider_transfer_status,
      'bank_settlement_status', new.bank_settlement_status
    )
  );
  return new;
exception when others then
  raise warning 'Drapeon tailor survey scheduling failed for payout %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_schedule_tailor_first_order_survey on public.payouts;
create trigger trg_schedule_tailor_first_order_survey
after insert or update of status, provider_transfer_status, bank_settlement_status, order_id, settlement_tranche_id
on public.payouts
for each row execute function public.schedule_tailor_first_order_survey();

alter table public.survey_invites enable row level security;
revoke all on public.survey_invites from public, anon, authenticated;
grant select, insert, update on public.survey_invites to service_role;

revoke all on function public.enqueue_survey_invite(text, text, text, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_survey_invite(text, text, text, uuid, text, timestamptz, jsonb)
  to service_role;

comment on table public.survey_invites is
  'Private, idempotent survey eligibility records. Domain transitions create invites; a later delivery worker owns sending and suppression.';
comment on column public.survey_invites.available_at is
  'Earliest delivery time after the authoritative transition: customer/tailor completion 24h, support resolution 2h.';
