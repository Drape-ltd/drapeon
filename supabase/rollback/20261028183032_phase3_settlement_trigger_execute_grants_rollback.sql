-- Restore the pre-migration execute grants only if this privilege repair is
-- explicitly rolled back.
alter function public.prevent_settlement_evidence_mutation() reset search_path;

grant execute on function public.prevent_settlement_evidence_mutation()
  to public, service_role;
