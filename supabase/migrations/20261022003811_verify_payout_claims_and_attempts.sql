do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.payout_claims'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.payout_attempts'::regclass) then
    raise exception 'Payout claim and attempt tables require RLS';
  end if;
  if has_table_privilege('anon','public.payout_claims','INSERT')
    or has_table_privilege('authenticated','public.payout_attempts','UPDATE') then
    raise exception 'Clients must not write payout claims or attempts';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.payout_claims'::regclass
    and conname='payout_claims_business_key_key')
    or not exists (select 1 from pg_constraint where conrelid='public.payout_claims'::regclass
    and conname='payout_claims_provider_idempotency_key_key') then
    raise exception 'Payout business and provider keys must be unique';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.payout_claims'::regclass
    and tgname='payout_claim_identity_immutable' and not tgisinternal) then
    raise exception 'Payout claim identity trigger is missing';
  end if;
end;
$$;
