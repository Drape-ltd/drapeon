-- Once a provider refund ID has been bound, retain it even while an attempt is
-- pending or unknown. Clearing it would make lookup-only recovery ambiguous.
do $repair$
declare
  v_definition text;
  v_repaired text;
begin
  select pg_get_functiondef(
    'public.guard_order_payment_refund_attempt()'::regprocedure
  ) into v_definition;

  if position(
    'if old.provider_refund_id is not null and new.provider_refund_id is not null' in v_definition
  ) = 0 or position(
    'and old.provider_refund_id <> new.provider_refund_id then' in v_definition
  ) = 0 then
    raise exception 'Refund-attempt provider-ID guard differs from the reviewed source';
  end if;

  v_repaired := replace(
    v_definition,
    'if old.provider_refund_id is not null and new.provider_refund_id is not null'
      || chr(10) || '    and old.provider_refund_id <> new.provider_refund_id then',
    'if old.provider_refund_id is not null'
      || chr(10) || '    and new.provider_refund_id is distinct from old.provider_refund_id then'
  );
  if v_repaired = v_definition then
    raise exception 'Refund-attempt provider-ID guard replacement did not apply';
  end if;
  execute v_repaired;
end;
$repair$;
