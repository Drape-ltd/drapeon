-- Run against an empty local PostgreSQL database only. All fixtures roll back.
\set ON_ERROR_STOP on
begin;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.money_desk_requests (
  id uuid primary key, action_type text, target_type text, order_id text, target_id text,
  action_payload jsonb, status text, approved_at timestamptz, approval_count integer,
  required_approval_count integer, requester_email text, reason text, amount integer,
  currency text
);
create table public.money_desk_decisions (
  id uuid primary key, request_id uuid, approver_email text, decision text
);
create table public.orders (id text primary key, stage text, special_note text);
create table public.disputes (
  id text primary key, order_id text, status text, resolution text,
  resolved_at timestamptz, resolved_by uuid, updated_at timestamptz
);
create table public.ops_issues (
  id uuid primary key, order_id text, issue_type text, status text, metadata jsonb,
  assigned_to text, resolved_at timestamptz, last_seen_at timestamptz
);
create table public.order_payments (
  id uuid primary key, order_id text, status text, amount integer, refunded_amount integer
);
create table public.order_material_advances (
  id uuid primary key, status text, release_status text, reconciliation_status text,
  reconciliation_outcome text, reconciled_at timestamptz,
  reconciliation_resolved_at timestamptz, reconciliation_resolution text
);
create table public.money_desk_execution_attempts (
  id uuid primary key, request_id uuid, status text, started_at timestamptz
);
create table public.ops_audit_logs (
  id uuid default gen_random_uuid() primary key, issue_id uuid, action_taken text,
  performed_by text, performed_role text, reason text, before_state jsonb, after_state jsonb
);

create function public.finalize_order_terminal(
  p_order_id uuid, p_target_stage text, p_actor_id text, p_actor_role text,
  p_event text, p_note text, p_payload jsonb, p_expected_stages text[],
  p_special_note text, p_replace_special_note boolean,
  p_clear_payment_session boolean, p_reset_fulfillment_payment boolean,
  p_release_ready_made_inventory boolean
) returns uuid language plpgsql as $$
begin
  if not exists (
    select 1 from public.orders where id = p_order_id::text
      and (p_expected_stages is null or stage = any(p_expected_stages))
  ) then raise exception 'Order terminal precondition failed.'; end if;
  update public.orders set stage = p_target_stage,
    special_note = case when p_replace_special_note then p_special_note else special_note end
    where id = p_order_id::text;
  return p_order_id;
end;
$$;

create function public.complete_money_desk_execution(
  p_attempt_id uuid, p_status text, p_provider_reference text,
  p_failure_code text, p_failure_summary text
) returns jsonb language plpgsql as $$
begin
  update public.money_desk_execution_attempts set status = p_status where id = p_attempt_id;
  update public.money_desk_requests set status = p_status where id = (
    select request_id from public.money_desk_execution_attempts where id = p_attempt_id
  );
  return jsonb_build_object('status', p_status);
end;
$$;

\i supabase/migrations/20261107194113_cancellation_review_money_desk_refund.sql

insert into public.orders values
  ('11111111-1111-4111-8111-111111111111', 'IN_DISPUTE', null),
  ('22222222-2222-4222-8222-222222222222', 'IN_DISPUTE',
   '{"cancellationReview":{"status":"OPEN","requestedAt":"2026-11-07T10:00:00Z"}}');
insert into public.disputes(id,order_id,status) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'OPEN');
insert into public.order_payments values
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'REFUNDED', 100, 100),
  ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'REFUNDED', 13531, 13531);
insert into public.ops_issues(id,order_id,issue_type,status,metadata) values
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'ORDER_REVIEW', 'OPEN', '{}'::jsonb),
  ('77777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', 'ORDER_REVIEW', 'OPEN', '{"review_type":"CANCELLATION"}');
insert into public.money_desk_requests values
  ('88888888-8888-4888-8888-888888888888', 'CUSTOMER_REFUND', 'ORDER_CANCELLATION',
   '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
   '{"disputeId":"33333333-3333-4333-8333-333333333333","paymentClaims":[{"paymentId":"44444444-4444-4444-8444-444444444444"}]}'::jsonb,
   'EXECUTING', now(), 1, 1, 'preparer@example.test', 'Approved dispute refund', 100, 'USD'),
  ('99999999-9999-4999-8999-999999999999', 'CUSTOMER_REFUND', 'ORDER_CANCELLATION',
   '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
   '{"reviewIssueId":"77777777-7777-4777-8777-777777777777","reviewRequestedAt":"2026-11-07T10:00:00Z","paymentClaims":[{"paymentId":"55555555-5555-4555-8555-555555555555"}]}'::jsonb,
   'EXECUTING', now(), 1, 1, 'preparer@example.test', 'Approved review refund', 13531, 'USD');
insert into public.money_desk_decisions values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'approver@example.test', 'APPROVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '99999999-9999-4999-8999-999999999999', 'approver@example.test', 'APPROVE');
insert into public.money_desk_execution_attempts values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '88888888-8888-4888-8888-888888888888', 'PROCESSING', now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '99999999-9999-4999-8999-999999999999', 'PROCESSING', now());

do $$
declare outcome jsonb;
begin
  outcome := public.finalize_ops_order_cancellation_refund(
    '88888888-8888-4888-8888-888888888888', '33333333-3333-4333-8333-333333333333',
    're_test_dispute', 'operator@example.test', 'ADMIN');
  if outcome->>'status' <> 'SUCCEEDED' then raise exception 'Dispute path did not complete.'; end if;
  if not exists (select 1 from public.orders where id = '11111111-1111-4111-8111-111111111111' and stage = 'REFUNDED')
     or not exists (select 1 from public.disputes where id = '33333333-3333-4333-8333-333333333333' and status = 'RESOLVED_REFUNDED' and resolved_by is null)
     or not exists (select 1 from public.ops_issues where id = '66666666-6666-4666-8666-666666666666' and status = 'RESOLVED')
     or not exists (select 1 from public.money_desk_execution_attempts where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and status = 'SUCCEEDED')
  then raise exception 'Dispute terminal records did not agree.'; end if;
  outcome := public.finalize_ops_order_cancellation_refund(
    '88888888-8888-4888-8888-888888888888', '33333333-3333-4333-8333-333333333333');
  if outcome->>'duplicate' <> 'true' then raise exception 'Dispute replay was not idempotent.'; end if;
  raise notice 'PASS dispute-backed refund and duplicate replay';

  outcome := public.finalize_ops_order_cancellation_refund(
    '99999999-9999-4999-8999-999999999999', null,
    're_test_review', 'operator@example.test', 'ADMIN');
  if outcome->>'status' <> 'SUCCEEDED' then raise exception 'Review path did not complete.'; end if;
  if not exists (select 1 from public.orders where id = '22222222-2222-4222-8222-222222222222' and stage = 'REFUNDED'
    and special_note::jsonb->'cancellationReview'->>'status' = 'RESOLVED')
     or not exists (select 1 from public.ops_issues where id = '77777777-7777-4777-8777-777777777777' and status = 'RESOLVED')
     or not exists (select 1 from public.money_desk_execution_attempts where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' and status = 'SUCCEEDED')
  then raise exception 'Review terminal records did not agree.'; end if;
  outcome := public.finalize_ops_order_cancellation_refund('99999999-9999-4999-8999-999999999999', null);
  if outcome->>'duplicate' <> 'true' then raise exception 'Review replay was not idempotent.'; end if;
  raise notice 'PASS review-backed refund and duplicate replay';
end;
$$;

rollback;
