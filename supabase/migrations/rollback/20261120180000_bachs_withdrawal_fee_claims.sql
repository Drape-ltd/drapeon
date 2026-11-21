-- Local rehearsal only. Never discard real provider-linked withdrawal claims.
do $$ begin
  if exists (select 1 from public.bachs_withdrawal_fee_claims) then
    raise exception 'Cannot roll back Bachs withdrawal claims while rows exist.';
  end if;
end $$;
drop table if exists public.bachs_withdrawal_fee_events;
drop table if exists public.bachs_withdrawal_fee_claims;
drop function if exists public.guard_bachs_withdrawal_fee_claim();
drop function if exists public.audit_bachs_withdrawal_fee_claim();
