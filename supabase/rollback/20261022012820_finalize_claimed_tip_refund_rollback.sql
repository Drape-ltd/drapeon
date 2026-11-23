do $$
begin
  if exists (select 1 from public.tip_money_operation_claims where operation_kind = 'REFUND' and status = 'SUCCEEDED') then
    raise exception 'Cannot remove claimed-tip refund finalization while a confirmed refund exists';
  end if;
end;
$$;

drop function if exists public.finalize_claimed_tip_refund(uuid,uuid,text);
