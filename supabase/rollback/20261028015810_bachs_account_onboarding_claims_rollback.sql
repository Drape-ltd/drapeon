-- Rollback only before any Bachs recipient-account setup claim is in use.
drop function if exists public.bind_bachs_account_setup(uuid, text);
drop function if exists public.reserve_bachs_account_setup(text, uuid, integer);
drop table if exists public.bachs_account_setup_claims;
