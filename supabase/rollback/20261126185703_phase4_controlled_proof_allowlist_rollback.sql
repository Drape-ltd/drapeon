-- Controlled proof rollback is only safe before a proof has been opened.
-- Preserve every audit row if the feature has been exercised; use a reviewed
-- forward repair instead of deleting the evidence.
do $$
begin
  if exists (select 1 from public.phase4_payment_proofs) then
    raise exception 'PHASE4_PROOF_ROLLBACK_HAS_EVIDENCE';
  end if;
end $$;

drop function if exists public.expire_phase4_payment_proofs(integer);
drop function if exists public.kill_phase4_payment_proof(uuid,text,text);
drop function if exists public.bind_phase4_proof_attempt(uuid,uuid);
drop function if exists public.authorize_phase4_proof_checkout(uuid,text,integer,text,text,text);
drop function if exists public.accept_phase4_payment_proof(uuid,uuid,integer,uuid,text,text);
drop function if exists public.accept_phase4_order_quote_with_route_snapshot_v2(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text);
drop function if exists public.accept_phase4_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text);
drop function if exists public.phase4_proof_context_valid(text,uuid,uuid,uuid,integer);
drop function if exists public.open_phase4_payment_proof(text,text,text,integer,uuid,integer,timestamptz,text);
drop trigger if exists guard_phase4_payment_proof_before_update on public.phase4_payment_proofs;
drop function if exists public.guard_phase4_payment_proof();
drop table if exists public.phase4_payment_proof_events;
drop table if exists public.phase4_payment_proofs;
