do $test$
begin
  if (select count(*) from public.notification_delivery_outcomes
      where status = 'DELIVERED') <> 8 then
    raise exception 'rollback did not restore eight legacy delivered rows';
  end if;
  if exists (select 1 from public.notification_delivery_outcomes
             where metadata ? 'legacy_push_audit_repair') then
    raise exception 'rollback left repair metadata';
  end if;
  if exists (select 1 from public.push_delivery_attempts
             where notification_job_id is not null) then
    raise exception 'rollback left historical attempt links';
  end if;
  if (select status from public.notification_delivery_outcomes
      where job_id = '00000000-0000-0000-0000-000000000005') <> 'ACCEPTED' then
    raise exception 'rollback changed the pre-existing accepted outcome';
  end if;
  raise notice 'PASS: rollback restored the exact fixture statuses, metadata and links';
end;
$test$;
