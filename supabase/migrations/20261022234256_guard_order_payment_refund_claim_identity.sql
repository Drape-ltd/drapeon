-- Defense in depth for direct service-role writes and sequential partial refunds.
create function public.guard_order_payment_refund_claim_identity()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  v_payment public.order_payments%rowtype;
begin
  if tg_op='UPDATE' then
    if row(new.payment_id,new.order_id,new.phase,new.provider,new.currency,
        new.charged_amount,new.refunded_before,new.refund_amount,
        new.provider_payment_id,new.operation_key,new.created_at)
      is distinct from
      row(old.payment_id,old.order_id,old.phase,old.provider,old.currency,
        old.charged_amount,old.refunded_before,old.refund_amount,
        old.provider_payment_id,old.operation_key,old.created_at)
      or (old.provider_refund_id is not null
        and new.provider_refund_id is distinct from old.provider_refund_id) then
      raise exception 'Refund claim identity cannot change';
    end if;
    return new;
  end if;

  select * into v_payment from public.order_payments
    where id=new.payment_id for update;
  if not found or v_payment.order_id::text is distinct from new.order_id
    or v_payment.phase is distinct from new.phase
    or v_payment.provider is distinct from new.provider
    or v_payment.currency is distinct from new.currency
    or v_payment.amount is distinct from new.charged_amount
    or v_payment.provider_payment_id is distinct from new.provider_payment_id
    or coalesce(v_payment.refunded_amount,0) is distinct from new.refunded_before
    or v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or new.refunded_before + new.refund_amount > v_payment.amount then
    raise exception 'Refund claim does not match the current settled payment';
  end if;
  if exists (
    select 1 from public.order_payment_refund_claims c
    where c.payment_id=new.payment_id
      and c.refunded_before < new.refunded_before
      and c.status <> 'SUCCEEDED'
  ) then
    raise exception 'Earlier refund claim needs provider reconciliation';
  end if;
  return new;
end;
$$;
create trigger order_payment_refund_claim_identity_guard
  before insert or update on public.order_payment_refund_claims
  for each row execute function public.guard_order_payment_refund_claim_identity();
revoke all on function public.guard_order_payment_refund_claim_identity()
  from public, anon, authenticated;
