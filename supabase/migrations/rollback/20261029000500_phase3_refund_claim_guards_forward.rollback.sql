-- Preserve durable money guards and evidence; roll back dependent Edge entrypoints.
do $$ begin
  raise exception 'Forward-only claim guard repair: disable dependent money Edge entrypoints instead of dropping guards';
end $$;
