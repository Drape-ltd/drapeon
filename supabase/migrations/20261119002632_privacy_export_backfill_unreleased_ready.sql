-- Existing READY packages without an Ops release return to review.
update public.tailor_data_exports
set status = 'IN_REVIEW'
where status = 'READY' and not (metadata ? 'released_at');
