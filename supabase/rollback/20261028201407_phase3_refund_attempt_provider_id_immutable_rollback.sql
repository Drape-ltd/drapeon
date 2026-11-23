-- Forward-only: restoring a guard that allows a bound provider refund ID to
-- disappear would make refund replay and reconciliation unsafe.
do $rollback$
begin
  raise exception 'Forward-only refund provider identity guard';
end;
$rollback$;
