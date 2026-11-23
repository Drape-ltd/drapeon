-- Roll back only before any operation has been reserved. Claims are financial
-- evidence and must not be discarded after the feature is exercised.
do $$
begin
  if exists (select 1 from public.tip_money_operation_claims limit 1) then
    raise exception 'Tip operation claims exist; disable callers and roll forward instead of deleting financial history';
  end if;
end;
$$;

drop function if exists public.reserve_tip_money_operation(uuid, text, text, uuid);
drop table if exists public.tip_money_operation_claims;
