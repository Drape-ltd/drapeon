-- This correction is deliberately forward-only. Reverting it would restore a
-- known runtime type error in ready-made checkout. Do not roll it back; ship a
-- reviewed forward correction if another compatibility issue is found.
do $rollback$
begin
  raise exception 'Forward-only migration: refusing to restore the known-broken ready-made route snapshot RPC';
end
$rollback$;
