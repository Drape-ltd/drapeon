-- pg_cron reports success when pg_net merely queues an Edge request. Persist
-- request IDs and reconcile the eventual HTTP result into the authoritative
-- Ops ledger, including Slack delivery through the existing audit trigger.

create table public.cron_edge_invocations (
  request_id bigint primary key,
  function_name text not null check (function_name ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  outcome text not null default 'PENDING' check (outcome in ('PENDING','SUCCEEDED','FAILED')),
  status_code integer,
  error_message text,
  response_observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cron_edge_invocations_pending_idx
  on public.cron_edge_invocations (created_at)
  where outcome = 'PENDING';

alter table public.cron_edge_invocations enable row level security;
revoke all on public.cron_edge_invocations from public, anon, authenticated;
grant select on public.cron_edge_invocations to service_role;

create or replace function util.invoke_monitored_edge_function(
  name text,
  body jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 300000
)
returns bigint
language plpgsql
security definer
set search_path = public, util, extensions, pg_temp
as $$
declare
  v_request_id bigint;
begin
  v_request_id := util.invoke_edge_function(name, body, timeout_milliseconds);
  if v_request_id is not null then
    insert into public.cron_edge_invocations(request_id, function_name)
    values (v_request_id, name)
    on conflict (request_id) do nothing;
  end if;
  return v_request_id;
end;
$$;

revoke all on function util.invoke_monitored_edge_function(text,jsonb,integer) from public, anon, authenticated;

create or replace function public.reconcile_cron_edge_outcomes(p_limit integer default 50)
returns table(processed integer, failed integer)
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_row record;
  v_issue public.ops_issues%rowtype;
  v_environment text := public.current_ops_environment();
  v_processed integer := 0;
  v_failed integer := 0;
  v_failure boolean;
  v_status integer;
  v_error text;
  v_now timestamptz := now();
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Cron outcome batch must be between 1 and 100.' using errcode = '22023';
  end if;
  if v_environment not in ('DEVELOPMENT','PRODUCTION') then
    raise exception 'Cron outcome monitor requires a bound environment.' using errcode = '55000';
  end if;

  for v_row in
    select i.request_id, i.function_name, i.created_at,
      r.status_code, r.timed_out, r.error_msg, r.created as response_created
    from public.cron_edge_invocations i
    left join net._http_response r on r.id = i.request_id
    where i.outcome = 'PENDING'
      and i.created_at < v_now - interval '10 seconds'
    order by i.created_at, i.request_id
    limit p_limit
    for update of i skip locked
  loop
    if v_row.status_code is null and v_row.created_at >= v_now - interval '10 minutes' then
      continue;
    end if;

    v_processed := v_processed + 1;
    v_status := coalesce(v_row.status_code, 0);
    v_error := case
      when v_row.status_code is null then 'No pg_net response was recorded within 10 minutes.'
      when coalesce(v_row.timed_out, false) then 'The Edge request timed out.'
      when v_row.error_msg is not null then left(v_row.error_msg, 500)
      when v_row.status_code < 200 or v_row.status_code >= 300 then 'Edge returned HTTP ' || v_row.status_code::text || '.'
      else null
    end;
    v_failure := v_error is not null;

    update public.cron_edge_invocations
    set outcome = case when v_failure then 'FAILED' else 'SUCCEEDED' end,
        status_code = v_status,
        error_message = v_error,
        response_observed_at = coalesce(v_row.response_created, v_now),
        updated_at = v_now
    where request_id = v_row.request_id;

    select * into v_issue
    from public.ops_issues
    where dedupe_key = 'cron-edge:' || v_row.function_name
    for update;

    if v_failure then
      v_failed := v_failed + 1;
      if v_issue.id is null then
        insert into public.ops_issues (
          issue_type, severity, status, source, provider, related_entity_type,
          related_entity_id, title, description, recommended_action, dedupe_key,
          metadata, queue_key, owning_team, priority, environment,
          canonical_status, provenance
        ) values (
          'SYSTEM_ALERT', 'HIGH', 'OPEN', 'cron-edge-outcome-monitor', 'SUPABASE',
          'cron_edge_invocation', v_row.request_id::text,
          'Scheduled Edge function failed: ' || v_row.function_name,
          v_error,
          'Inspect the pg_net response and Edge logs, restore the function or dependency, then verify the next scheduled run.',
          'cron-edge:' || v_row.function_name,
          jsonb_build_object('function',v_row.function_name,'requestId',v_row.request_id,'httpStatus',v_status,'observedAt',v_now),
          'reliability', 'engineering', 'P1', v_environment, 'NEW',
          case when v_environment='PRODUCTION' then 'REAL' else 'QA' end
        ) returning * into v_issue;

        insert into public.ops_audit_logs(issue_id, action_taken, performed_role, reason, after_state)
        values (v_issue.id, 'ISSUE_CREATED', 'SYSTEM', 'Scheduled Edge request returned a terminal failure.',
          jsonb_build_object('requestId',v_row.request_id,'httpStatus',v_status,'function',v_row.function_name));
      else
        update public.ops_issues
        set last_seen_at=v_now,
            description=v_error,
            related_entity_id=v_row.request_id::text,
            metadata=jsonb_build_object('function',v_row.function_name,'requestId',v_row.request_id,'httpStatus',v_status,'observedAt',v_now),
            updated_at=v_now
        where id=v_issue.id;
      end if;
    elsif v_issue.id is not null and v_issue.canonical_status not in ('RESOLVED','CLOSED') then
      update public.ops_issues
      set status='RESOLVED', canonical_status='RESOLVED', resolved_at=v_now,
          last_seen_at=v_now, updated_at=v_now
      where id=v_issue.id;
      insert into public.ops_audit_logs(issue_id, action_taken, performed_role, reason, before_state, after_state)
      values (v_issue.id, 'ISSUE_RESOLVED', 'SYSTEM', 'The next scheduled Edge request completed successfully.',
        jsonb_build_object('canonicalStatus',v_issue.canonical_status),
        jsonb_build_object('canonicalStatus','RESOLVED','requestId',v_row.request_id,'httpStatus',v_status));
    end if;
  end loop;

  return query select v_processed, v_failed;
end;
$$;

revoke all on function public.reconcile_cron_edge_outcomes(integer) from public, anon, authenticated;
grant execute on function public.reconcile_cron_edge_outcomes(integer) to service_role;

select cron.schedule(
  'purge-tailor-drafts',
  '17 * * * *',
  $job$select util.invoke_monitored_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$
);

select cron.schedule(
  'reconcile-cron-edge-outcomes',
  '*/5 * * * *',
  $job$select public.reconcile_cron_edge_outcomes(50);$job$
);
