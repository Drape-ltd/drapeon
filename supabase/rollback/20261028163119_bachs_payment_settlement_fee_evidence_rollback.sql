-- Dev recorded the migration version as 20261028163119.
revoke all on function public.register_bachs_payment_settlement_check(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_bachs_payment_settlement_check(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_bachs_payment_settlement_check(uuid, text, text, integer, currency, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;

drop function public.register_bachs_payment_settlement_check(uuid, text, text);
drop function public.claim_bachs_payment_settlement_check(uuid);
drop function public.record_bachs_payment_settlement_check(uuid, text, text, integer, currency, text, timestamptz, timestamptz);
drop trigger provider_payment_settlement_check_guard on public.provider_payment_settlement_checks;
drop function public.guard_provider_payment_settlement_check();
drop table public.provider_payment_settlement_checks;
