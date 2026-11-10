-- Older SEND_PUSH jobs recorded DELIVERED when the worker finished, before
-- Expo receipts could prove delivery. Preserve the old assertion for rollback,
-- link only unambiguous historical attempts, and fail closed to ACCEPTED when
-- receipt evidence is missing or ambiguous. No notification is resent.
do $repair$
begin
  create temporary table legacy_push_audit_repair_targets on commit drop as
  with legacy as (
    select o.id outcome_id, o.job_id, o.terminal_at,
           j.payload->>'userId' user_id,
           j.payload->'notification'->'data'->>'orderId' order_id
    from public.notification_delivery_outcomes o
    join public.job_queue j on j.id = o.job_id
    where o.channel = 'PUSH'
      and o.status = 'DELIVERED'
      and o.provider = 'EXPO_OR_WEB_PUSH'
      and not (o.metadata ? 'legacy_push_audit_repair')
      and not exists (
        select 1 from public.push_delivery_attempts a
        where a.notification_job_id = o.job_id
      )
  ), raw_matches as (
    select l.outcome_id, a.id attempt_id
    from legacy l
    join public.push_delivery_attempts a
      on a.notification_job_id is null
     and a.user_id::text = l.user_id
     and a.order_id::text = l.order_id
     and a.created_at between l.terminal_at - interval '1 second'
                          and l.terminal_at + interval '1 second'
  ), candidates as (
    select outcome_id, min(attempt_id::text)::uuid attempt_id, count(*) candidate_count
    from raw_matches group by outcome_id
  ), attempt_uses as (
    select attempt_id, count(*) outcome_count
    from raw_matches group by attempt_id
  ), unique_matches as (
    select c.outcome_id, c.attempt_id
    from candidates c
    join attempt_uses u on u.attempt_id = c.attempt_id
    where c.candidate_count = 1 and u.outcome_count = 1
  )
  select l.outcome_id, l.job_id, m.attempt_id,
         a.status attempt_status, a.error_code
  from legacy l
  left join unique_matches m on m.outcome_id = l.outcome_id
  left join public.push_delivery_attempts a on a.id = m.attempt_id;

  update public.push_delivery_attempts a
     set notification_job_id = t.job_id
    from legacy_push_audit_repair_targets t
   where a.id = t.attempt_id and a.notification_job_id is null;

  update public.notification_delivery_outcomes o
     set status = case
           when t.attempt_status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED')
             then 'DEAD'
           else 'ACCEPTED'
         end,
         reason = case
           when t.attempt_status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED')
             then coalesce(nullif(t.error_code, ''), 'HISTORICAL_PUSH_RECEIPT_ERROR')
           else 'HISTORICAL_PUSH_DELIVERY_UNVERIFIED'
         end,
         metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
           'legacy_push_audit_repair', jsonb_build_object(
             'prior_status', o.status,
             'prior_reason', o.reason,
             'prior_terminal_at', o.terminal_at,
             'matched_attempt_id', t.attempt_id,
             'repaired_status', case
               when t.attempt_status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED')
                 then 'DEAD' else 'ACCEPTED' end
           )
         ),
         terminal_at = now()
    from legacy_push_audit_repair_targets t
   where o.id = t.outcome_id and o.status = 'DELIVERED';
end;
$repair$;
