-- Development only: all fixtures and any trigger-created outbox work roll back.
begin;
do $$
declare
  v_key text := 'queue-parity-' || gen_random_uuid()::text;
  v_bad jsonb;
  v_page jsonb;
  v_expected jsonb;
  v_actual jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then raise exception 'Development only'; end if;
  foreach v_bad in array array['null'::jsonb,'[]'::jsonb,'1'::jsonb,'"x"'::jsonb,
    '{"page":null}'::jsonb,'{"page":[]}'::jsonb,'{"page":0}'::jsonb,
    '{"page":1.5}'::jsonb,'{"page":"-1"}'::jsonb,'{"scope":null}'::jsonb,
    '{"q":{}}'::jsonb,'{"ownership":"someone"}'::jsonb] loop
    begin
      perform public.ops_queue_page('DEVELOPMENT',array['admin'],'founders@drapeon.co',v_bad);
      raise exception 'Accepted malformed queue filter: %',v_bad;
    exception when invalid_parameter_value then null; end;
  end loop;

  insert into public.ops_issues(issue_type,severity,status,source,title,description,recommended_action,
    dedupe_key,environment,provenance,queue_key,priority,created_at)
  select 'SYSTEM_ALERT', 'HIGH', 'OPEN', 'ops-queue-regression',v_key,'Rollback-only queue regression',
    'No external action required',v_key || '-' || n,'DEVELOPMENT','QA','reliability',
    case when n % 2 = 0 then 'P2' else 'P3' end,now() - n * interval '1 minute'
  from generate_series(1,25) n;

  select jsonb_agg(id order by priority,
    case severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'WARNING' then 2 when 'LOW' then 3 else 4 end,
    case when first_responded_at is null then coalesce(first_response_due_at,active_resolution_due_at) else active_resolution_due_at end nulls last,
    created_at,id) into v_expected from public.ops_issues where title=v_key;
  for n in 1..2 loop
    v_page := public.ops_queue_page('DEVELOPMENT',array['admin'],'founders@drapeon.co',jsonb_build_object('q',v_key,'page',n));
    if (v_page->>'total')::int <> 25 or (v_page->>'pages')::int <> 2 then raise exception 'Queue count mismatch'; end if;
    v_actual := v_actual || (v_page->'ids');
    if n=1 then v_summary := v_page->'summary';
    elsif v_summary is distinct from v_page->'summary' then raise exception 'Summary changed by page'; end if;
  end loop;
  if v_actual is distinct from v_expected then raise exception 'Queue ordering, overlap or missing rows'; end if;
  v_page := public.ops_queue_page('DEVELOPMENT',array['admin'],'founders@drapeon.co',jsonb_build_object('q',v_key,'page','9999999'));
  if (v_page->>'page')::int <> 2 or jsonb_array_length(v_page->'ids') <> 5 then raise exception 'Page clamp failed'; end if;
  v_page := public.ops_queue_page('DEVELOPMENT',array['not-an-ops-role'],'nobody@example.test',jsonb_build_object('q',v_key));
  if (v_page->>'total')::int <> 0 or jsonb_array_length(v_page->'ids') <> 0 then raise exception 'Role isolation failed'; end if;
  v_page := public.ops_queue_page('PRODUCTION',array['admin'],'founders@drapeon.co',jsonb_build_object('q',v_key));
  if (v_page->>'total')::int <> 0 then raise exception 'Environment isolation failed'; end if;
  update public.ops_issues set canonical_status='CLOSED',status='RESOLVED' where title=v_key;
  v_page := public.ops_queue_page('DEVELOPMENT',array['admin'],'founders@drapeon.co',jsonb_build_object('q',v_key));
  if (v_page->>'total')::int <> 0 then raise exception 'Closed cases leaked into open queue'; end if;
  v_actual := '[]'::jsonb;
  for n in 1..2 loop
    v_page := public.ops_queue_page('DEVELOPMENT',array['admin'],'founders@drapeon.co',jsonb_build_object('q',v_key,'scope','closed','page',n));
    v_actual := v_actual || (v_page->'ids');
  end loop;
  select jsonb_agg(id order by updated_at desc nulls last,created_at,id) into v_expected from public.ops_issues where title=v_key;
  if v_actual is distinct from v_expected then raise exception 'Closed case page order mismatch'; end if;
  if has_function_privilege('anon','public.ops_queue_page(text,text[],text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.ops_queue_page(text,text[],text,jsonb)','EXECUTE') then
    raise exception 'Queue RPC exposed to public role'; end if;
end;
$$;
rollback;
