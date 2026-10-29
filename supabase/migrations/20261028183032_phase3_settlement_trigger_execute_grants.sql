-- Trigger-only append-only guard; no app or worker calls this as an RPC.
-- Remove the default PUBLIC EXECUTE grant left by the original migration.
alter function public.prevent_settlement_evidence_mutation() set search_path = '';

revoke all on function public.prevent_settlement_evidence_mutation()
  from public, anon, authenticated, service_role;
