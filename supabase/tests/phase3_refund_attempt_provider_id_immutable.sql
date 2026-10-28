-- A provider ID may be bound once, but never cleared or retargeted afterward.
create temporary table refund_attempt_guard_probe (
  like public.order_payment_refund_attempts including defaults including constraints
) on commit drop;

create trigger refund_attempt_guard_probe_trigger
before insert or update on refund_attempt_guard_probe
for each row execute function public.guard_order_payment_refund_attempt();

do $test$
declare
  v_id uuid;
begin
  insert into refund_attempt_guard_probe (
    refund_claim_id, attempt_number, provider_reference, idempotency_key,
    status, provider_charge_id
  ) values (
    gen_random_uuid(), 1, 'refund-probe', 'refund-probe-key',
    'RESERVED', 'ch_refund_probe'
  ) returning id into v_id;

  update refund_attempt_guard_probe
  set status = 'PROVIDER_PENDING', provider_refund_id = 'rf_first'
  where id = v_id;

  begin
    update refund_attempt_guard_probe set provider_refund_id = null where id = v_id;
    raise exception 'Clearing a bound provider refund ID was accepted';
  exception when others then
    if sqlerrm <> 'Refund attempt provider identity is immutable' then
      raise;
    end if;
  end;

  begin
    update refund_attempt_guard_probe set provider_refund_id = 'rf_other' where id = v_id;
    raise exception 'Retargeting a bound provider refund ID was accepted';
  exception when others then
    if sqlerrm <> 'Refund attempt provider identity is immutable' then
      raise;
    end if;
  end;

  update refund_attempt_guard_probe set provider_refund_id = 'rf_first' where id = v_id;
  if (select provider_refund_id from refund_attempt_guard_probe where id = v_id) <> 'rf_first' then
    raise exception 'The original provider refund ID was not retained';
  end if;
end;
$test$;
