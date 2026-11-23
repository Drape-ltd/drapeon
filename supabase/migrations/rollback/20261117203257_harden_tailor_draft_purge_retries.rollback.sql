do $$
begin
  if exists (select 1 from public.tailor_draft_purges where step <> 'DONE') then
    raise exception 'Tailor draft purge ledger has unfinished work; complete or inspect it before rollback';
  end if;
end $$;

-- Alert reopening and bounded invocation retention are safe independently of
-- the purge ledger, so rollback intentionally preserves that monitor repair.
drop table public.tailor_draft_purges;
