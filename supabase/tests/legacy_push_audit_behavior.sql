do $test$
declare
  v_status text;
  v_link uuid;
begin
  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000001';
  if v_status <> 'DEAD' then raise exception 'unique failed receipt should be DEAD, got %', v_status; end if;
  select notification_job_id into v_link from public.push_delivery_attempts
  where id = '40000000-0000-0000-0000-000000000001';
  if v_link <> '00000000-0000-0000-0000-000000000001' then raise exception 'failed receipt link missing'; end if;

  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000002';
  if v_status <> 'ACCEPTED' then raise exception 'provider acceptance is not delivery'; end if;

  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000003';
  if v_status <> 'ACCEPTED' then raise exception 'ambiguous receipts must be unverified'; end if;
  if exists (select 1 from public.push_delivery_attempts
             where id in ('40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004')
               and notification_job_id is not null) then
    raise exception 'ambiguous receipts must remain unlinked';
  end if;

  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000004';
  if v_status <> 'ACCEPTED' then raise exception 'missing receipt must be unverified'; end if;

  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000005';
  if v_status <> 'ACCEPTED' then raise exception 'already accepted must be unchanged'; end if;
  if exists (select 1 from public.notification_delivery_outcomes
             where job_id = '00000000-0000-0000-0000-000000000005'
               and metadata ? 'legacy_push_audit_repair') then
    raise exception 'already accepted must not be rewritten';
  end if;

  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000006';
  if v_status <> 'ACCEPTED' then raise exception 'shared candidate must be unverified'; end if;
  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000007';
  if v_status <> 'ACCEPTED' then raise exception 'shared candidate second outcome must be unverified'; end if;
  select status into v_status from public.notification_delivery_outcomes
  where job_id = '00000000-0000-0000-0000-000000000008';
  if v_status <> 'DELIVERED' then raise exception 'WEB_PUSH outside repair scope changed'; end if;

  if (select count(*) from public.notification_delivery_outcomes
      where metadata ? 'legacy_push_audit_repair') <> 6 then
    raise exception 'repair did not mark exactly six legacy rows';
  end if;
  raise notice 'PASS: unique failure, accepted, ambiguous, missing, existing and web cases';
end;
$test$;
