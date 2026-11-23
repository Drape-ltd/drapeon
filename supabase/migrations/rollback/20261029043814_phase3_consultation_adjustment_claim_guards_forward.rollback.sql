-- Preserve durable consultation/adjustment money guards and claim identity.
-- Roll back dependent Edge entrypoints instead of dropping protections.
do $$ begin
  raise exception 'Forward-only consultation/adjustment claim guard repair: disable dependent money Edge entrypoints instead of dropping guards';
end $$;
