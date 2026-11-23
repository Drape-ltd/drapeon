-- R2 forward repair: establish the PAY-003 payment/refund tables on the
-- current schema. No historical migration version is replayed or marked applied.
-- These public-schema tables are service-owned and denied to client roles in
-- this same transaction, including projects with permissive default grants.

do $$
begin
  if (select atttypid from pg_attribute where attrelid='public.order_payments'::regclass
      and attname='id' and not attisdropped) <> 'uuid'::regtype then
    raise exception 'PAY003_ORDER_PAYMENT_ID_TYPE_DRIFT';
  end if;
  if (select atttypid from pg_attribute where attrelid='public.orders'::regclass
      and attname='id' and not attisdropped) not in ('uuid'::regtype, 'text'::regtype) then
    raise exception 'PAY003_ORDER_ID_TYPE_DRIFT';
  end if;
end;
$$;

-- PAY-003: payment outcomes are monotonic and stale provider events are inert.

create table if not exists public.payment_status_transition_audits (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  provider public.payment_provider not null,
  provider_event_id text not null,
  from_status public.order_payment_status not null,
  to_status public.order_payment_status not null,
  event text not null default 'payment.stale_status_ignored'
    check (event = 'payment.stale_status_ignored'),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (payment_id, provider_event_id, from_status, to_status)
);

alter table public.payment_status_transition_audits enable row level security;
revoke all on public.payment_status_transition_audits from public, anon, authenticated;
grant select, insert on public.payment_status_transition_audits to service_role;

create table if not exists public.order_payment_provider_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  provider public.payment_provider not null,
  provider_refund_id text not null,
  amount integer not null check (amount > 0),
  status text not null check (status in ('CONFIRMED', 'FAILED')),
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_refund_id)
);

create index if not exists order_payment_provider_refunds_payment_idx
  on public.order_payment_provider_refunds(payment_id, status, created_at);
alter table public.order_payment_provider_refunds enable row level security;
revoke all on public.order_payment_provider_refunds from public, anon, authenticated;
grant select, insert, update on public.order_payment_provider_refunds to service_role;

create table if not exists public.payment_late_success_refund_operations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.order_payments(id) on delete restrict,
  provider public.payment_provider not null,
  provider_payment_id text not null,
  amount integer not null check (amount > 0),
  currency public.currency not null,
  provider_event_id text not null,
  idempotency_key text not null unique,
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED')),
  provider_refund_id text,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_late_success_refund_operations enable row level security;
revoke all on public.payment_late_success_refund_operations from public, anon, authenticated;
grant select, insert, update on public.payment_late_success_refund_operations to service_role;


-- CREATE TABLE IF NOT EXISTS must never silently accept a different table.
do $$
declare
  v_expected text[][] := array[
    array['payment_status_transition_audits','id','uuid'],
    array['payment_status_transition_audits','payment_id','uuid'],
    array['payment_status_transition_audits','provider','payment_provider'],
    array['payment_status_transition_audits','provider_event_id','text'],
    array['payment_status_transition_audits','from_status','order_payment_status'],
    array['payment_status_transition_audits','to_status','order_payment_status'],
    array['payment_status_transition_audits','event','text'],
    array['payment_status_transition_audits','payload','jsonb'],
    array['payment_status_transition_audits','created_at','timestamptz'],
    array['order_payment_provider_refunds','id','uuid'],
    array['order_payment_provider_refunds','payment_id','uuid'],
    array['order_payment_provider_refunds','provider','payment_provider'],
    array['order_payment_provider_refunds','provider_refund_id','text'],
    array['order_payment_provider_refunds','amount','int4'],
    array['order_payment_provider_refunds','status','text'],
    array['order_payment_provider_refunds','provider_response','jsonb'],
    array['order_payment_provider_refunds','created_at','timestamptz'],
    array['order_payment_provider_refunds','updated_at','timestamptz'],
    array['payment_late_success_refund_operations','id','uuid'],
    array['payment_late_success_refund_operations','payment_id','uuid'],
    array['payment_late_success_refund_operations','provider','payment_provider'],
    array['payment_late_success_refund_operations','provider_payment_id','text'],
    array['payment_late_success_refund_operations','amount','int4'],
    array['payment_late_success_refund_operations','currency','currency'],
    array['payment_late_success_refund_operations','provider_event_id','text'],
    array['payment_late_success_refund_operations','idempotency_key','text'],
    array['payment_late_success_refund_operations','status','text'],
    array['payment_late_success_refund_operations','provider_refund_id','text'],
    array['payment_late_success_refund_operations','provider_response','jsonb'],
    array['payment_late_success_refund_operations','created_at','timestamptz'],
    array['payment_late_success_refund_operations','updated_at','timestamptz']
  ];
  v_row text[];
begin
  foreach v_row slice 1 in array v_expected loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_row[1]
        and c.column_name=v_row[2] and c.udt_name=v_row[3]
    ) then
      raise exception 'PAY003_TABLE_SHAPE_DRIFT: %.%', v_row[1], v_row[2];
    end if;
  end loop;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.payment_status_transition_audits'::regclass
      and c.contype='f' and c.confrelid='public.order_payments'::regclass
  ) or not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.order_payment_provider_refunds'::regclass
      and c.contype='f' and c.confrelid='public.order_payments'::regclass
  ) or not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.payment_late_success_refund_operations'::regclass
      and c.contype='f' and c.confrelid='public.order_payments'::regclass
  ) then
    raise exception 'PAY003_PAYMENT_FK_DRIFT';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.payment_status_transition_audits'::regclass and contype='p')
     or not exists (select 1 from pg_constraint where conrelid='public.order_payment_provider_refunds'::regclass and contype='p')
     or not exists (select 1 from pg_constraint where conrelid='public.payment_late_success_refund_operations'::regclass and contype='p')
     or not exists (select 1 from pg_constraint where conrelid='public.order_payment_provider_refunds'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (provider, provider_refund_id)') then
    raise exception 'PAY003_KEY_CONSTRAINT_DRIFT';
  end if;
end;
$$;
