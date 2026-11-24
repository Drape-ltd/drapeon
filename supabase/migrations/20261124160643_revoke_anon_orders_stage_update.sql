-- Issue #299: anonymous requests must never invoke stage-transition triggers.
-- Production currently inherits UPDATE on orders.stage from a table-level grant.
-- Revoke both possible grant shapes so RLS is not the only protection.
revoke update on table public.orders from anon;
revoke update (stage) on table public.orders from anon;

do $verification$
begin
  if has_table_privilege('anon', 'public.orders', 'UPDATE') then
    raise exception 'anon retains table-level UPDATE on public.orders';
  end if;

  if has_column_privilege('anon', 'public.orders', 'stage', 'UPDATE') then
    raise exception 'anon retains column-level UPDATE on public.orders.stage';
  end if;
end;
$verification$;
