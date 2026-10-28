-- Preserve the refund journal and audited request history before rolling back.
do $$
begin
  if exists (
    select 1 from public.consultation_post_payout_refund_claims
    where status = 'SUCCEEDED' or ledger_transaction_id is not null
  ) then
    raise exception 'Cannot remove consultation post-payout refund claims with posted ledger entries.';
  end if;
end;
$$;

drop function if exists public.finalize_consultation_post_payout_refund_claim(uuid, uuid);
drop function if exists public.mark_consultation_post_payout_refund_ops_review(uuid, text);
drop function if exists public.record_consultation_post_payout_refund_provider_result(uuid, text, text, jsonb);
drop function if exists public.claim_consultation_post_payout_refund(uuid, uuid, uuid, integer);
drop table if exists public.consultation_post_payout_refund_claims;
