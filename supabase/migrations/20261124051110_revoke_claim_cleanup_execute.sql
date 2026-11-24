-- Development-only hardening. This function is a trigger target; no API role
-- should call it directly through PostgREST or GraphQL.
do $$
begin
  if to_regprocedure('public.cleanup_terminal_tailor_claim_provider_identity()') is null then
    raise exception
      'expected public.cleanup_terminal_tailor_claim_provider_identity() before revoking execute';
  end if;
end;
$$;

revoke execute on function public.cleanup_terminal_tailor_claim_provider_identity()
  from public, anon, authenticated;
