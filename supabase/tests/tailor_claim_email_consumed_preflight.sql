-- Read-only production preflight for migration 20261119044734.
-- Run immediately before the migration. It fails closed if the old constraint
-- is absent, renamed, or differs from the definition this migration replaces.
do $preflight$
declare
  observed text;
begin
  select pg_get_constraintdef(c.oid)
    into observed
  from pg_constraint c
  where c.conrelid = to_regclass('public.tailor_claim_email_codes')
    and c.conname = 'tailor_claim_email_codes_check1';

  if observed is distinct from
    'CHECK (((status = ''VERIFIED''::text) = (verified_at IS NOT NULL)))' then
    raise exception
      'Preflight stopped: expected tailor_claim_email_codes_check1 to be the original VERIFIED/verified_at check; observed: %',
      coalesce(observed, '<missing>');
  end if;
end;
$preflight$;
