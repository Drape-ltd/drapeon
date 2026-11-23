do $$
begin
  if to_regclass('public.order_payment_refund_attempts') is not null
    and exists (select 1 from public.order_payment_refund_attempts) then
    raise exception 'Cannot roll back Bachs refund attempts after any attempt has been recorded';
  end if;
end;
$$;

drop function if exists public.record_bachs_payment_refund_attempt_outcome(uuid, text, text, jsonb);
drop function if exists public.reserve_bachs_payment_refund_attempt(uuid);
drop trigger if exists order_payment_refund_attempt_guard on public.order_payment_refund_attempts;
drop function if exists public.guard_order_payment_refund_attempt();
drop table if exists public.order_payment_refund_attempts;
