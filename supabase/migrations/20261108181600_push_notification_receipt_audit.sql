-- Expo ticket acceptance is not delivery. Link durable jobs to their receipts
-- so a terminal provider error can correct the job-level audit outcome.

alter table public.push_delivery_attempts
  add column if not exists notification_job_id uuid
  references public.job_queue(id) on delete set null;

create index if not exists push_delivery_attempts_notification_job_idx
  on public.push_delivery_attempts (notification_job_id)
  where notification_job_id is not null;

create or replace function public.record_notification_delivery_outcome(
  p_job_id uuid,
  p_channel text,
  p_status text,
  p_recipient_user_id uuid default null,
  p_order_id uuid default null,
  p_reason text default null,
  p_provider text default null,
  p_provider_reference text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outcome_id uuid;
begin
  if p_channel not in ('PUSH', 'EMAIL', 'SMS') then
    raise exception 'unsupported notification channel';
  end if;
  if p_status not in ('ACCEPTED', 'DELIVERED', 'SKIPPED', 'DEAD') then
    raise exception 'unsupported notification outcome';
  end if;
  if p_status = 'ACCEPTED' and p_channel not in ('EMAIL', 'PUSH') then
    raise exception 'provider acceptance is only tracked for email or push';
  end if;

  insert into public.notification_delivery_outcomes (
    event_id, job_id, channel, recipient_user_id, order_id, status, reason,
    provider, provider_reference, metadata
  )
  select
    jobs.event_id, jobs.id, p_channel, p_recipient_user_id, p_order_id,
    p_status, nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_provider, '')), ''),
    nullif(btrim(coalesce(p_provider_reference, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  from public.job_queue jobs
  where jobs.id = p_job_id
  on conflict (job_id) do update set
    status = excluded.status,
    reason = excluded.reason,
    provider = excluded.provider,
    provider_reference = excluded.provider_reference,
    metadata = public.notification_delivery_outcomes.metadata || excluded.metadata,
    terminal_at = now()
  returning id into v_outcome_id;

  if v_outcome_id is null then raise exception 'notification job not found'; end if;
  return v_outcome_id;
end;
$$;

revoke all on function public.record_notification_delivery_outcome(
  uuid, text, text, uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_notification_delivery_outcome(
  uuid, text, text, uuid, uuid, text, text, text, jsonb
) to service_role;

-- Called after a receipt reaches a terminal provider result. Keep an accepted
-- result while another device is pending, or when at least one was accepted.
create or replace function public.reconcile_push_notification_outcome(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outcome public.notification_delivery_outcomes%rowtype;
  v_pending integer;
  v_accepted integer;
  v_failed integer;
  v_reason text;
begin
  select * into v_outcome
  from public.notification_delivery_outcomes
  where job_id = p_job_id and channel = 'PUSH'
  for update;
  if not found then return 'OUTCOME_NOT_READY'; end if;
  if v_outcome.status <> 'ACCEPTED' then return v_outcome.status; end if;
  -- A browser push may have been accepted even when every Expo device fails.
  if v_outcome.provider in ('WEB_PUSH', 'EXPO_AND_WEB_PUSH') then return 'ACCEPTED'; end if;

  select count(*) filter (where status in ('TICKET_ACCEPTED', 'RECEIPT_PENDING')),
         count(*) filter (where status = 'PROVIDER_ACCEPTED'),
         count(*) filter (where status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED')),
         min(error_code) filter (where status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED'))
    into v_pending, v_accepted, v_failed, v_reason
  from public.push_delivery_attempts
  where notification_job_id = p_job_id;

  if v_pending > 0 then return 'PENDING'; end if;
  if v_accepted > 0 then return 'ACCEPTED'; end if;
  if v_failed = 0 then return 'NO_RECEIPT'; end if;

  update public.notification_delivery_outcomes
     set status = 'DEAD',
         reason = coalesce(v_reason, 'PUSH_PROVIDER_REJECTED'),
         metadata = metadata || jsonb_build_object('receipt_reconciled', true),
         terminal_at = now()
   where id = v_outcome.id;
  return 'DEAD';
end;
$$;

revoke all on function public.reconcile_push_notification_outcome(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_push_notification_outcome(uuid)
  to service_role;

-- Receipt and audit transition must commit together. If the outcome row does
-- not exist yet, finish_notification_job invokes the same reconciliation RPC.
create or replace function public.sync_push_notification_outcome_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.notification_job_id is not null then
    perform public.reconcile_push_notification_outcome(new.notification_job_id);
  end if;
  return new;
end;
$$;

revoke all on function public.sync_push_notification_outcome_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists sync_push_notification_outcome_on_attempt
  on public.push_delivery_attempts;
create trigger sync_push_notification_outcome_on_attempt
  after insert or update of status on public.push_delivery_attempts
  for each row execute function public.sync_push_notification_outcome_trigger();
