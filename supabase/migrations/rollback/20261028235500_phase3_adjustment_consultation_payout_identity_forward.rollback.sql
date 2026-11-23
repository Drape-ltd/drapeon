-- Payout identity fields and accepted policy snapshots may carry durable
-- money evidence. Keep them; disable dependent entrypoints if rollback is needed.
do $$ begin
  raise exception 'Forward-only payout identity repair: do not remove money snapshots';
end $$;
