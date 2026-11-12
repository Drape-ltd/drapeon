create schema if not exists cron;

create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);

create function cron.schedule(p_name text, p_schedule text, p_command text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job(jobname, schedule, command)
  values (p_name, p_schedule, p_command) returning jobid into v_id;
  return v_id;
end;
$$;

create function cron.unschedule(p_id bigint)
returns boolean language plpgsql as $$
begin
  delete from cron.job where jobid = p_id;
  return found;
end;
$$;

create function public.current_ops_environment()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('drape.test_ops_environment', true), ''), 'DEVELOPMENT')
$$;
