-- Dev recorded the matching migration as version 20261028164058.
-- Restore the table privileges inherited from the project's default ACLs.
grant all on table public.provider_payment_settlement_checks to service_role;
