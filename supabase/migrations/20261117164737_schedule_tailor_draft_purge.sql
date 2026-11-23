-- Run the bounded, idempotent draft-retention worker once per hour. The Edge
-- Function caps each class of work at 50 rows and safely rechecks eligibility
-- before every destructive transition.

create extension if not exists pg_cron;

do $$
begin
  if to_regprocedure('util.invoke_edge_function(text,jsonb,integer)') is null then
    raise exception 'util.invoke_edge_function(text,jsonb,integer) must exist before scheduling tailor draft purge';
  end if;

  perform cron.schedule(
    'purge-tailor-drafts',
    '17 * * * *',
    $job$select util.invoke_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$
  );
end
$$;
