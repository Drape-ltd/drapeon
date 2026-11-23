do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tip_money_operation_claims'
      and column_name='provider' and data_type='text'
  ) then raise exception 'Tip claim provider must be provider-neutral text'; end if;
end;
$$;
