create schema if not exists public;

create table public.job_queue (
  id uuid primary key,
  payload jsonb not null
);

create table public.notification_delivery_outcomes (
  id uuid primary key,
  job_id uuid not null unique references public.job_queue(id),
  channel text not null,
  status text not null check (status in ('ACCEPTED', 'DELIVERED', 'SKIPPED', 'DEAD')),
  provider text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  terminal_at timestamptz not null
);

create table public.push_delivery_attempts (
  id uuid primary key,
  user_id uuid not null,
  order_id uuid,
  notification_job_id uuid references public.job_queue(id),
  status text not null,
  error_code text,
  created_at timestamptz not null
);

create table public.web_push_subscriptions (
  id uuid primary key,
  audience text not null,
  user_id uuid,
  endpoint text not null unique,
  created_at timestamptz not null
);

create index on public.push_delivery_attempts (order_id, created_at desc);
create index on public.push_delivery_attempts (user_id, created_at desc);

insert into public.job_queue (id, payload)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       jsonb_build_object(
         'userId', '10000000-0000-0000-0000-000000000001',
         'notification', jsonb_build_object('data', jsonb_build_object(
           'orderId', '20000000-0000-0000-0000-000000000001')))
from generate_series(1, 9) n;

insert into public.notification_delivery_outcomes
  (id, job_id, channel, status, provider, terminal_at)
select ('30000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'PUSH', case when n = 5 then 'ACCEPTED' else 'DELIVERED' end,
       case when n = 8 then 'WEB_PUSH' else 'EXPO_OR_WEB_PUSH' end,
       '2026-11-08 16:45:00+00'::timestamptz + n * interval '1 minute'
from generate_series(1, 9) n;

-- Unique failed and accepted receipts; two failed attempts for job 3; no
-- receipt for job 4; pre-existing accepted job 5; one receipt shared by jobs
-- 6 and 7; mixed accepted/failed attempts for job 9.
insert into public.push_delivery_attempts
  (id, user_id, order_id, status, error_code, created_at)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'DELIVERY_ERROR', 'DeveloperError', '2026-11-08 16:46:00.2+00'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'PROVIDER_ACCEPTED', null, '2026-11-08 16:47:00.2+00'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'DELIVERY_ERROR', 'DeviceNotRegistered', '2026-11-08 16:48:00.2+00'),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'DELIVERY_ERROR', 'DeveloperError', '2026-11-08 16:48:00.3+00'),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'DELIVERY_ERROR', 'DeveloperError', '2026-11-08 16:51:00.2+00'),
  ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'DELIVERY_ERROR', 'DeviceNotRegistered', '2026-11-08 16:54:00.2+00'),
  ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'PROVIDER_ACCEPTED', null, '2026-11-08 16:54:00.3+00');

-- Give the second legacy outcome the same timestamp as job 6 so its shared
-- candidate tests the one-to-one guard. WEB_PUSH remains out of scope.
update public.notification_delivery_outcomes
   set terminal_at = '2026-11-08 16:51:00+00'
 where job_id = '00000000-0000-0000-0000-000000000007';

-- A browser subscription predating job 10 leaves open the possibility that
-- browser push succeeded despite every Expo receipt failing. Job 11's
-- subscription was created later, so it cannot explain that old send.
insert into public.job_queue (id, payload) values
  ('00000000-0000-0000-0000-000000000010', '{"userId":"10000000-0000-0000-0000-000000000010","notification":{"data":{"orderId":"20000000-0000-0000-0000-000000000010"}}}'),
  ('00000000-0000-0000-0000-000000000011', '{"userId":"10000000-0000-0000-0000-000000000011","notification":{"data":{"orderId":"20000000-0000-0000-0000-000000000011"}}}');
insert into public.notification_delivery_outcomes
  (id, job_id, channel, status, provider, terminal_at) values
  ('30000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000010', 'PUSH', 'DELIVERED', 'EXPO_OR_WEB_PUSH', '2026-11-08 16:55:00+00'),
  ('30000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'PUSH', 'DELIVERED', 'EXPO_OR_WEB_PUSH', '2026-11-08 16:56:00+00');
insert into public.push_delivery_attempts
  (id, user_id, order_id, status, error_code, created_at) values
  ('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000010', 'TICKET_ERROR', 'DeveloperError', '2026-11-08 16:55:00.2+00'),
  ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', 'TICKET_ERROR', 'DeveloperError', '2026-11-08 16:56:00.2+00');
insert into public.web_push_subscriptions (id, audience, user_id, endpoint, created_at) values
  ('50000000-0000-0000-0000-000000000010', 'ACCOUNT', '10000000-0000-0000-0000-000000000010', 'https://example.invalid/push/10', '2026-11-08 16:54:00+00'),
  ('50000000-0000-0000-0000-000000000011', 'ACCOUNT', '10000000-0000-0000-0000-000000000011', 'https://example.invalid/push/11', '2026-11-08 16:57:00+00');
