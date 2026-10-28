begin;

do $$
declare
  v_identity int;
  v_status int;
begin
  select count(*) into v_identity from pg_trigger
    where tgrelid = 'public.order_payment_refund_claims'::regclass
      and tgname = 'order_payment_refund_claim_identity_guard'
      and not tgisinternal and tgenabled = 'O';
  select count(*) into v_status from pg_trigger
    where tgrelid = 'public.order_payment_refund_claims'::regclass
      and tgname = 'order_payment_refund_claim_status_guard'
      and not tgisinternal and tgenabled = 'O';
  if v_identity <> 1 or v_status <> 1 then
    raise exception 'Refund claim guards must both be attached and enabled';
  end if;
  if has_function_privilege('anon',
      'public.guard_order_payment_refund_claim_identity()', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.guard_order_payment_refund_claim_status()', 'EXECUTE') then
    raise exception 'Client roles must not execute refund claim guards';
  end if;
end;
$$;

-- The identity trigger must reject a claim with no settled source payment
-- before the foreign key can be reached.
do $$
begin
  begin
    insert into public.order_payment_refund_claims (
      payment_id, order_id, phase, provider, currency,
      charged_amount, refunded_before, refund_amount,
      provider_payment_id, operation_key
    ) values (
      gen_random_uuid(), 'qa-refund-guard', 'INITIAL_ORDER', 'STRIPE', 'GBP',
      100, 0, 100, 'qa-nonexistent', 'qa-refund-guard:' || gen_random_uuid()::text
    );
    raise exception 'Unmatched refund claim insert unexpectedly succeeded';
  exception
    when raise_exception then
      if sqlerrm <> 'Refund claim does not match the current settled payment' then
        raise;
      end if;
  end;
end;
$$;

-- Exercise the status trigger on an isolated relation with the same row shape.
create temporary table qa_refund_claim_status
  (like public.order_payment_refund_claims including defaults);
create trigger qa_refund_claim_status_guard
  before insert or update on qa_refund_claim_status
  for each row execute function public.guard_order_payment_refund_claim_status();
insert into qa_refund_claim_status (
  payment_id, order_id, phase, provider, currency,
  charged_amount, refunded_before, refund_amount,
  provider_payment_id, operation_key
) values (
  gen_random_uuid(), 'qa-refund-status', 'INITIAL_ORDER', 'STRIPE', 'GBP',
  100, 0, 100, 'qa-nonexistent', 'qa-refund-status'
);
do $$
begin
  begin
    update qa_refund_claim_status set status = 'SUCCEEDED';
    raise exception 'Successful refund without provider ID unexpectedly succeeded';
  exception
    when raise_exception then
      if sqlerrm <> 'Refund claim status transition is unsafe' then
        raise;
      end if;
  end;
end;
$$;

rollback;
