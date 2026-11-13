create schema if not exists public;
create function public.current_ops_environment() returns text language sql as $$ select 'DEVELOPMENT'::text $$;
create table public.ops_workforce_principals (id uuid primary key, email text, status text, permitted_environments text[], access_review_due_at timestamptz, roles text[]);
create table public.ops_queue_policies (id uuid primary key, environment text, queue_key text, active boolean, retired_at timestamptz, effective_at timestamptz, updated_at timestamptz, permitted_roles text[], permitted_actions text[]);
create table public.orders (id text primary key, stage text);
create table public.job_queue (id uuid primary key, status text, job_type text);
create table public.ops_issues (
  id uuid primary key default gen_random_uuid(), case_number text default 'OPS-TEST', issue_type text, severity text,
  status text, canonical_status text, source text, order_id text, related_entity_type text,
  related_entity_id text, title text, description text, recommended_action text, dedupe_key text unique,
  metadata jsonb, queue_key text, priority text, environment text, provenance text,
  record_version integer default 1, sensitivity text default 'INTERNAL', created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.ops_action_receipts (
  id uuid primary key default gen_random_uuid(), issue_id uuid, action_key text, idempotency_key text,
  actor_principal_id uuid, expected_record_version integer, resulting_record_version integer,
  outcome text, human_status text, correlation_id uuid, completed_at timestamptz
);
create table public.ops_job_case_members (job_id uuid, issue_id uuid, environment text);
create table public.ops_case_events (
  issue_id uuid, event_type text, visibility text, sensitivity text, actor_principal_id uuid,
  actor_label text, to_status text, summary text, payload jsonb, idempotency_key text, correlation_id uuid
);
create table public.ops_audit_logs (issue_id uuid, action_taken text, performed_by text, performed_role text, reason text, after_state jsonb);

insert into public.ops_workforce_principals values (
  '11111111-1111-4111-8111-111111111111', 'ops-qa@example.invalid', 'ACTIVE', array['development'], now() + interval '1 day', array['ops']
);
insert into public.ops_queue_policies values (
  '22222222-2222-4222-8222-222222222222', 'DEVELOPMENT', 'operations', true, null, now() - interval '1 day', now(), array['ops'], array['triage']
);
insert into public.orders values ('fixture-order-1','IN_DISPUTE'), ('fixture-order-2','IN_DISPUTE');
insert into public.ops_issues (id,case_number,issue_type,severity,status,canonical_status,source,order_id,related_entity_type,related_entity_id,title,dedupe_key,environment,provenance)
values
  ('33333333-3333-4333-8333-333333333333','OPS-PUSH-1','SYSTEM_ALERT','HIGH','OPEN','NEW','push-receipts','fixture-order-1','job_queue','push-1','Push failed','push-failed:1','DEVELOPMENT','QA'),
  ('44444444-4444-4444-8444-444444444444','OPS-PUSH-2','SYSTEM_ALERT','HIGH','OPEN','NEW','push-receipts','fixture-order-2','job_queue','push-2','Push failed','push-failed:2','DEVELOPMENT','QA');
