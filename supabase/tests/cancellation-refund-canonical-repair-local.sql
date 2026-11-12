-- Isolated local PostgreSQL, matching the Dev join-column types; transaction rolls back.
\set ON_ERROR_STOP on
begin;
create type public.order_stage as enum ('IN_DISPUTE', 'REFUNDED');
create table public.orders (id text primary key, stage public.order_stage);
create table public.ops_issues (
  id uuid primary key, order_id text, issue_type text, status text,
  canonical_status text, resolved_at timestamptz, metadata jsonb,
  sensitivity text, correlation_id uuid
);
create table public.money_desk_requests (
  id uuid primary key, order_id text, status text, action_type text,
  target_type text, action_payload jsonb, correlation_id uuid, updated_at timestamptz
);
create table public.ops_job_recoveries (issue_id uuid, outcome text);
create table public.ops_case_events (
  id uuid primary key default gen_random_uuid(), issue_id uuid,
  event_type text, visibility text, sensitivity text, actor_label text,
  from_status text, to_status text, summary text, payload jsonb,
  idempotency_key text, correlation_id uuid, occurred_at timestamptz,
  unique(issue_id,idempotency_key)
);
insert into public.orders values
  ('11111111-1111-4111-8111-111111111111','REFUNDED'),
  ('22222222-2222-4222-8222-222222222222','IN_DISPUTE');
insert into public.ops_issues values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','ORDER_REVIEW','RESOLVED','NEW',now(),'{"review_type":"CANCELLATION"}','INTERNAL',null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','ORDER_REVIEW','RESOLVED','NEW',now(),'{"review_type":"CANCELLATION"}','INTERNAL',null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','ORDER_REVIEW','RESOLVED','NEW',now(),'{"review_type":"CANCELLATION"}','INTERNAL',null),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','ORDER_REVIEW','RESOLVED','RESOLVED',now(),'{"review_type":"CANCELLATION"}','INTERNAL',null),
  ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','ORDER_REVIEW','RESOLVED','NEW',now(),'{"review_type":"CANCELLATION"}','INTERNAL',null);
insert into public.money_desk_requests values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','SUCCEEDED','CUSTOMER_REFUND','ORDER_CANCELLATION','{"reviewIssueId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',gen_random_uuid(),now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','22222222-2222-4222-8222-222222222222','SUCCEEDED','CUSTOMER_REFUND','ORDER_CANCELLATION','{"reviewIssueId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}',gen_random_uuid(),now()),
  ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','SUCCEEDED','CUSTOMER_REFUND','ORDER_CANCELLATION','{"reviewIssueId":"99999999-9999-4999-8999-999999999999"}',gen_random_uuid(),now());
insert into public.ops_job_recoveries values ('99999999-9999-4999-8999-999999999999','PENDING');
\i supabase/migrations/20261109013500_repair_cancellation_refund_case_status.sql
do $$
begin
  if (select count(*) from public.ops_issues where canonical_status='RESOLVED') <> 2
     or (select count(*) from public.ops_case_events) <> 1
     or not exists(select 1 from public.ops_issues where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and canonical_status='RESOLVED')
     or not exists(select 1 from public.ops_issues where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and canonical_status='NEW')
     or not exists(select 1 from public.ops_issues where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' and canonical_status='NEW')
     or not exists(select 1 from public.ops_issues where id='99999999-9999-4999-8999-999999999999' and canonical_status='NEW')
  then raise exception 'Canonical case repair selection was unsafe.'; end if;
  raise notice 'PASS only proven refunded review case repaired';
end;
$$;
\i supabase/migrations/20261109013500_repair_cancellation_refund_case_status.sql
do $$
begin
  if (select count(*) from public.ops_case_events) <> 1 then
    raise exception 'Canonical repair replay duplicated an event.';
  end if;
  raise notice 'PASS canonical repair replay';
end;
$$;
rollback;
