-- Dev recorded this migration as version 20261028164058.
-- Keep the monitor's SELECT access, but make the RPCs the only write surface.
-- Supabase's default ACLs had granted service_role direct DML on this table;
-- SECURITY DEFINER functions remain the controlled writer.
revoke all on table public.provider_payment_settlement_checks from service_role;
grant select on table public.provider_payment_settlement_checks to service_role;
