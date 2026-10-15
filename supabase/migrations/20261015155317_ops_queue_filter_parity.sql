-- Forward repair: reject malformed filters and guarantee page ordering.
-- Read-only queue selection. The broker supplies verified roles and email;
-- browser clients cannot call this function directly. Existing detail reads
-- retain their privacy and protected-action gates.
create or replace function public.ops_queue_page(
  p_environment text,
  p_roles text[],
  p_actor_email text,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '5s'
as $$
declare
  v_scope text := coalesce(nullif(p_filters->>'scope', ''), 'open');
  v_queue text := coalesce(nullif(p_filters->>'queue', ''), 'all');
  v_priority text := coalesce(nullif(p_filters->>'priority', ''), 'all');
  v_phase text := coalesce(nullif(p_filters->>'phase', ''), 'all');
  v_type text := coalesce(nullif(p_filters->>'caseType', ''), 'all');
  v_mine boolean := coalesce(p_filters->>'ownership', 'all') = 'mine';
  v_search text := trim(coalesce(p_filters->>'q', ''));
  v_page integer := 1;
  v_result jsonb;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'object'
    or exists (select 1 from jsonb_each(p_filters) f
      where f.key in ('scope','queue','priority','phase','caseType','ownership','q')
        and jsonb_typeof(f.value) <> 'string')
    or (p_filters ? 'page' and jsonb_typeof(p_filters->'page') not in ('number','string'))
    or coalesce(p_filters->>'ownership','all') not in ('all','mine') then
    raise exception 'Invalid queue filter shape' using errcode = '22023';
  end if;
  if p_environment not in ('DEVELOPMENT', 'PRODUCTION') or p_environment is null
    or coalesce(cardinality(p_roles), 0) = 0 then
    raise exception 'Invalid queue read identity' using errcode = '22023';
  end if;
  if v_scope not in ('open','closed','all','unassigned','overdue','due')
    or v_queue not in ('all','support','trust','privacy','money','delivery','reliability','operations')
    or v_priority not in ('all','critical','P0','P1','P2','P3','P4')
    or v_phase not in ('all','first-response','resolution')
    or length(v_search) > 160 or length(v_type) > 80
    or (v_mine and nullif(trim(p_actor_email), '') is null) then
    raise exception 'Invalid queue filters' using errcode = '22023';
  end if;
  if p_filters ? 'page' then
    if (p_filters->>'page') !~ '^[1-9][0-9]{0,6}$' then
      raise exception 'Invalid queue page' using errcode = '22023';
    end if;
    v_page := (p_filters->>'page')::integer;
  end if;

  -- Exact totals already require inspecting the matching set. Numbered pages
  -- reuse that materialized result; only twenty IDs leave the database.
  with normalized as materialized (
    select i.*,
      case
        when lower(coalesce(i.source,'')) = 'account-support-action'
          or upper(i.issue_type) = 'AFTERCARE_REQUEST'
          or lower(i.title) like '%support requested%' then 'support'
        when upper(i.issue_type) = 'CONTENT_FLAG' then 'trust'
        when lower(trim(i.queue_key)) = 'privacy-deletion' then 'privacy'
        when lower(trim(i.queue_key)) = 'trust-safety' then 'trust'
        when lower(trim(i.queue_key)) = 'money-desk' then 'money'
        when lower(trim(i.queue_key)) = 'delivery-supply' then 'delivery'
        when lower(trim(i.queue_key)) in ('reliability','operations') then lower(trim(i.queue_key))
        when upper(i.issue_type) ~ '(PAYOUT|PAYMENT|REFUND|SETTLEMENT)' then 'money'
        when upper(i.issue_type) ~ '(VERIFICATION|TRUST|SAFETY|BYPASS)' then 'trust'
        when upper(i.issue_type) ~ '(DELIVERY|DISPATCH|FULFILLMENT)' then 'delivery'
        when upper(i.issue_type) ~ '(INCIDENT|PROVIDER|WEBHOOK|JOB)' then 'reliability'
        when upper(i.issue_type) ~ '(DELETE|PRIVACY)' then 'privacy'
        else 'operations'
      end as display_queue,
      coalesce(i.canonical_status, i.status) not in ('RESOLVED','CLOSED','CANCELLED') as is_open,
      case when i.first_responded_at is null then coalesce(i.first_response_due_at,i.active_resolution_due_at)
        else i.active_resolution_due_at end as due_at
    from public.ops_issues i where i.environment = p_environment
  ), permitted as materialized (
    select n.* from normalized n
    where exists (
      select 1 from public.ops_queue_policies policy
      where policy.environment = p_environment and policy.active and policy.retired_at is null
        and policy.queue_key = case n.display_queue
          when 'trust' then 'trust-safety' when 'money' then 'money-desk'
          when 'privacy' then 'privacy-deletion' when 'delivery' then 'delivery-supply'
          else n.display_queue end
        and policy.permitted_roles && p_roles
    )
  ), matching as materialized (
    select n.* from permitted n
    where (v_queue = 'all' or n.display_queue = v_queue)
      and (v_type = 'all' or n.issue_type = v_type)
      and (not v_mine or lower(n.assigned_to) = lower(p_actor_email))
      and (v_priority = 'all' or (v_priority = 'critical' and n.priority in ('P0','P1')) or n.priority = v_priority)
      and (v_phase = 'all' or (v_phase = 'first-response' and n.first_responded_at is null)
        or (v_phase = 'resolution' and n.first_responded_at is not null))
      and (v_scope = 'all' or (v_scope = 'closed' and not n.is_open)
        or (n.is_open and (v_scope = 'open'
          or (v_scope = 'unassigned' and nullif(trim(n.assigned_to),'') is null)
          or (v_scope = 'overdue' and n.sla_clock_paused_at is null and n.due_at < now())
          or (v_scope = 'due' and n.sla_clock_paused_at is null and n.due_at between now() and now() + interval '4 hours'))))
      and (v_search = '' or strpos(lower(concat_ws(' ',n.case_number,n.title,n.description,n.issue_type,n.related_entity_id,n.order_id)), lower(v_search)) > 0
        or ltrim(v_search, '#0') = n.issue_number::text
        or exists (select 1 from public.orders o where o.id=n.order_id and strpos(lower(o.reference),lower(v_search)) > 0))
  ), totals as (
    select count(*) as total, greatest(1,ceil(count(*) / 20.0)::integer) as pages from matching
  ), page_rows as (
    select n.id, n.updated_at, n.created_at, n.priority, n.severity, n.due_at
    from matching n
    order by
      case when v_scope = 'closed' then n.updated_at end desc nulls last,
      case when v_scope <> 'closed' then n.priority end asc nulls last,
      case when v_scope <> 'closed' then case n.severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'WARNING' then 2 when 'LOW' then 3 else 4 end end,
      case when v_scope <> 'closed' then n.due_at end asc nulls last,
      n.created_at, n.id
    limit 20 offset (select (least(v_page,pages)-1)*20 from totals)
  )
  select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(id order by
      case when v_scope = 'closed' then updated_at end desc nulls last,
      case when v_scope <> 'closed' then priority end asc nulls last,
      case when v_scope <> 'closed' then case severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'WARNING' then 2 when 'LOW' then 3 else 4 end end,
      case when v_scope <> 'closed' then due_at end asc nulls last,
      created_at, id) from page_rows), '[]'::jsonb),
    'total', totals.total, 'page', least(v_page,totals.pages), 'pages', totals.pages,
    'summary', (select jsonb_build_object(
      'open', count(*) filter(where is_open),
      'urgent', count(*) filter(where is_open and priority in ('P0','P1')),
      'unassigned', count(*) filter(where is_open and nullif(trim(assigned_to),'') is null),
      'slaTracked', count(*) filter(where is_open and sla_clock_paused_at is null and due_at is not null),
      'breached', count(*) filter(where is_open and sla_clock_paused_at is null and due_at < now()),
      'approvals', count(*) filter(where is_open and issue_type='TAILOR_VERIFICATION')
    ) from permitted)
  ) into v_result from totals;
  return v_result;
end;
$$;

revoke all on function public.ops_queue_page(text,text[],text,jsonb) from public, anon, authenticated;
grant execute on function public.ops_queue_page(text,text[],text,jsonb) to service_role;
