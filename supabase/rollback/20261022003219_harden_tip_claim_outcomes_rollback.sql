do $$ begin
  if exists (select 1 from public.tip_money_operation_claims limit 1) then
    raise exception 'Tip claims exist; roll forward rather than removing outcome guards';
  end if;
end $$;

drop function public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb);
drop index public.tip_money_operation_provider_reference_idx;
alter table public.tip_money_operation_claims
  drop constraint tip_money_operation_terminal_evidence;
