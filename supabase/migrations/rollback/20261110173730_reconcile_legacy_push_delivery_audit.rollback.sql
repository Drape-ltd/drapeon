-- Restore only rows still in the state written by the forward repair. A later
-- provider update must not be overwritten by a rollback.
update public.push_delivery_attempts a
   set notification_job_id = null
  from public.notification_delivery_outcomes o
 where o.metadata ? 'legacy_push_audit_repair'
   and o.status = o.metadata->'legacy_push_audit_repair'->>'repaired_status'
   and exists (
     select 1
     from jsonb_array_elements_text(
       coalesce(o.metadata->'legacy_push_audit_repair'->'matched_attempt_ids', '[]'::jsonb)
     ) matched(attempt_id)
     where matched.attempt_id = a.id::text
   )
   and a.notification_job_id = o.job_id;

update public.notification_delivery_outcomes o
   set status = o.metadata->'legacy_push_audit_repair'->>'prior_status',
       reason = o.metadata->'legacy_push_audit_repair'->>'prior_reason',
       terminal_at = (o.metadata->'legacy_push_audit_repair'->>'prior_terminal_at')::timestamptz,
       metadata = o.metadata - 'legacy_push_audit_repair'
 where o.metadata ? 'legacy_push_audit_repair'
   and o.status = o.metadata->'legacy_push_audit_repair'->>'repaired_status';
