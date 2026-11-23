-- Keep purge identity outside the invite/profile/Auth cascade so a partially
-- completed deletion remains discoverable and retryable.
create table public.tailor_draft_purges (
  invite_id uuid primary key,
  tailor_user_id uuid not null,
  tailor_profile_id text not null,
  terminal_status text not null check (terminal_status in ('EXPIRED','REVOKED','DECLINED')),
  step text not null default 'QUEUED'
    check (step in ('QUEUED','MEDIA_DELETED','PROFILE_DELETED','AUTH_DELETED','DONE')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tailor_draft_purges_pending_idx
  on public.tailor_draft_purges (created_at)
  where step <> 'DONE';

alter table public.tailor_draft_purges enable row level security;
revoke all on public.tailor_draft_purges from public, anon, authenticated;
grant select, insert, update on public.tailor_draft_purges to service_role;

-- A recurring failure must reopen a terminal case and emit a fresh audit row
-- for Slack. Bound invocation history while preserving pending requests.
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
      elsif v_issue.canonical_status in ('RESOLVED','CLOSED') then
        update public.ops_issues
        set status='OPEN', canonical_status='NEW', resolved_at=null, closed_at=null,
            last_seen_at=v_now, description=v_error,
            related_entity_id=v_row.request_id::text,
            metadata=jsonb_build_object('function',v_row.function_name,'requestId',v_row.request_id,'httpStatus',v_status,'observedAt',v_now),
            updated_at=v_now
        where id=v_issue.id;
        insert into public.ops_audit_logs(issue_id, action_taken, performed_role, reason, before_state, after_state)
        values (v_issue.id, 'ISSUE_REOPENED', 'SYSTEM', 'A scheduled Edge function failed again after recovery.',
          jsonb_build_object('canonicalStatus',v_issue.canonical_status),
          jsonb_build_object('canonicalStatus','NEW','requestId',v_row.request_id,'httpStatus',v_status));
      else
        update public.ops_issues
        set last_seen_at=v_now, description=v_error,
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

  delete from public.cron_edge_invocations
  where request_id in (
    select request_id from public.cron_edge_invocations
    where outcome <> 'PENDING' and created_at < v_now - interval '30 days'
    order by created_at
    limit 500
  );

  return query select v_processed, v_failed;
end;
$$;

revoke all on function public.reconcile_cron_edge_outcomes(integer) from public, anon, authenticated;
grant execute on function public.reconcile_cron_edge_outcomes(integer) to service_role;
