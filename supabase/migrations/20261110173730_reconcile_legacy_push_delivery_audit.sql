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
  ), attempt_uses as (
    select attempt_id, count(*) outcome_count
    from raw_matches group by attempt_id
  ), candidate_groups as (
    select r.outcome_id,
           count(*) candidate_count,
           bool_and(u.outcome_count = 1) candidates_are_exclusive,
           count(*) filter (where a.status in ('TICKET_ACCEPTED', 'RECEIPT_PENDING')) pending_count,
           count(*) filter (where a.status = 'PROVIDER_ACCEPTED') accepted_count,
           count(*) filter (where a.status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED')) failed_count,
           min(a.error_code) filter (where a.status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED')) failure_reason,
           array_agg(r.attempt_id order by r.attempt_id) matched_attempt_ids
    from raw_matches r
    join attempt_uses u on u.attempt_id = r.attempt_id
    join public.push_delivery_attempts a on a.id = r.attempt_id
    group by r.outcome_id
  ), unique_groups as (
    select * from candidate_groups
    where candidate_count > 0 and candidates_are_exclusive
  )
  select l.outcome_id, l.job_id,
         g.matched_attempt_ids,
         case
           when g.outcome_id is not null and g.pending_count = 0
             and g.accepted_count = 0 and g.failed_count = g.candidate_count
             and not exists (
               select 1 from public.web_push_subscriptions w
               where w.audience = 'ACCOUNT'
                 and w.user_id::text = l.user_id
                 and w.created_at <= l.terminal_at
             )
             then 'DEAD'
           else 'ACCEPTED'
         end repaired_status,
         case
           when g.outcome_id is not null and g.pending_count = 0
             and g.accepted_count = 0 and g.failed_count = g.candidate_count
             and exists (
               select 1 from public.web_push_subscriptions w
               where w.audience = 'ACCOUNT'
                 and w.user_id::text = l.user_id
                 and w.created_at <= l.terminal_at
             )
             then 'HISTORICAL_PUSH_WEB_PUSH_UNVERIFIED'
           when g.outcome_id is not null and g.pending_count = 0
             and g.accepted_count = 0 and g.failed_count = g.candidate_count
             then coalesce(nullif(g.failure_reason, ''), 'HISTORICAL_PUSH_RECEIPT_ERROR')
           else 'HISTORICAL_PUSH_DELIVERY_UNVERIFIED'
         end repaired_reason
  from legacy l
  left join unique_groups g on g.outcome_id = l.outcome_id;

  update public.push_delivery_attempts a
     set notification_job_id = t.job_id
    from legacy_push_audit_repair_targets t
   where t.matched_attempt_ids is not null
     and a.id = any(t.matched_attempt_ids)
     and a.notification_job_id is null;

  update public.notification_delivery_outcomes o
     set status = t.repaired_status,
         reason = t.repaired_reason,
         metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
           'legacy_push_audit_repair', jsonb_build_object(
             'prior_status', o.status,
             'prior_reason', o.reason,
             'prior_terminal_at', o.terminal_at,
             'matched_attempt_ids', to_jsonb(t.matched_attempt_ids),
             'repaired_status', t.repaired_status
           )
         ),
         terminal_at = now()
    from legacy_push_audit_repair_targets t
   where o.id = t.outcome_id and o.status = 'DELIVERED';
end;
$repair$;
