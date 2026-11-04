-- Run after the migration inside a rollback transaction on Dev.
begin;

do $$
declare
  v_job_pending uuid := gen_random_uuid();
  v_job_error uuid := gen_random_uuid();
  v_job_mixed uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_status text;
begin
  insert into public.job_queue(id, job_type, status, payload)
  values (v_job_pending, 'SEND_PUSH', 'SUCCEEDED', '{}'::jsonb),
         (v_job_error, 'SEND_PUSH', 'SUCCEEDED', '{}'::jsonb),
         (v_job_mixed, 'SEND_PUSH', 'SUCCEEDED', '{}'::jsonb);

  perform public.record_notification_delivery_outcome(v_job_pending, 'PUSH', 'ACCEPTED');
  perform public.record_notification_delivery_outcome(v_job_error, 'PUSH', 'ACCEPTED');
  perform public.record_notification_delivery_outcome(
    v_job_mixed, 'PUSH', 'ACCEPTED', p_provider => 'EXPO_AND_WEB_PUSH');

  insert into public.push_delivery_attempts
    (id, notification_job_id, ticket_id, status)
  values
    (v_first, v_job_pending, 'test-' || v_first::text, 'TICKET_ACCEPTED'),
    (v_second, v_job_pending, 'test-' || v_second::text, 'TICKET_ACCEPTED');

  v_status := public.reconcile_push_notification_outcome(v_job_pending);
  if v_status <> 'PENDING' then raise exception 'two pending receipts must stay pending: %', v_status; end if;

  update public.push_delivery_attempts set status = 'DELIVERY_ERROR', error_code = 'BadDeviceToken' where id = v_first;
  v_status := public.reconcile_push_notification_outcome(v_job_pending);
  if v_status <> 'PENDING' then raise exception 'one pending receipt must retain accepted job: %', v_status; end if;

  update public.push_delivery_attempts set status = 'PROVIDER_ACCEPTED' where id = v_second;
  v_status := public.reconcile_push_notification_outcome(v_job_pending);
  if v_status <> 'ACCEPTED' then raise exception 'one accepted device must retain accepted job: %', v_status; end if;

  insert into public.push_delivery_attempts
    (notification_job_id, ticket_id, status, error_code)
  values (v_job_error, 'test-' || v_job_error::text, 'DELIVERY_ERROR', 'BadDeviceToken');
  v_status := public.reconcile_push_notification_outcome(v_job_error);
  if v_status <> 'DEAD' then raise exception 'all rejected receipts must mark job DEAD: %', v_status; end if;
  select status into v_status from public.notification_delivery_outcomes where job_id = v_job_error;
  if v_status <> 'DEAD' then raise exception 'stored audit outcome not DEAD: %', v_status; end if;
  v_status := public.reconcile_push_notification_outcome(v_job_error);
  if v_status <> 'DEAD' then raise exception 'terminal audit must remain terminal: %', v_status; end if;

  insert into public.push_delivery_attempts
    (notification_job_id, ticket_id, status, error_code)
  values (v_job_mixed, 'test-' || v_job_mixed::text, 'DELIVERY_ERROR', 'BadDeviceToken');
  v_status := public.reconcile_push_notification_outcome(v_job_mixed);
  if v_status <> 'ACCEPTED' then raise exception 'browser acceptance must survive Expo failure: %', v_status; end if;

  if has_function_privilege('anon', 'public.reconcile_push_notification_outcome(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reconcile_push_notification_outcome(uuid)', 'EXECUTE') then
    raise exception 'receipt audit correction must remain service-role only';
  end if;

  raise notice 'PASS push receipt audit: ticket accepted, pending, mixed result, terminal rejection';
end;
$$;

select 'PASS push notification receipt audit' as result;

rollback;
