-- A provider identity conflict cannot be cleared by a routine outcome RPC.
-- A future reviewed resolution needs an explicit, audited transition path.
create function public.prevent_unreviewed_blocked_payout_transition()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  if old.status = 'BLOCKED' and new.status <> 'BLOCKED' then
    raise exception 'Blocked payout claim requires reviewed reconciliation';
  end if;
  return new;
end;
$$;

create trigger payout_claim_blocked_transition_guard
  before update of status on public.payout_claims
  for each row execute function public.prevent_unreviewed_blocked_payout_transition();

revoke execute on function public.prevent_unreviewed_blocked_payout_transition()
  from public, anon, authenticated;
