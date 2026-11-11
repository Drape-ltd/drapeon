-- Roll back the Edge workers and Money Desk routes that use this operation
-- before dropping it. Do not roll back while any reviewed retry is active.
do $$ begin
  if exists (select 1 from public.dispatch_refund_retry_operations
    where status in ('QUEUED','PROCESSING','PENDING')) then
    raise exception 'ACTIVE_DISPATCH_REFUND_RETRY_ROLLBACK_BLOCKED';
  end if;
  if exists (select 1 from public.order_fulfillment_runs
    where customer_provider_refund_id is not null) then
    raise exception 'RECORDED_DISPATCH_REFUND_IDS_MUST_BE_ARCHIVED_BEFORE_ROLLBACK';
  end if;
end $$;
drop function public.queue_reviewed_dispatch_refund_retry(uuid,text,text);
drop table public.dispatch_refund_retry_operations;
drop function public.guard_dispatch_refund_retry_operation();
alter table public.order_fulfillment_runs drop column customer_provider_refund_id;
