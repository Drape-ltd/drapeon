-- Roll back the additive RPC only after the release-order-tip Edge rollout is
-- reverted. Existing payout, tip, ledger, and Ops evidence is never deleted.
do $$
begin
  if exists (select 1 from public.tip_money_operation_claims
    where operation_kind='PAYOUT' and provider='STRIPE' and status='SUCCEEDED'
      and created_at >= '2026-10-22'::timestamptz) then
    raise exception 'Review confirmed Stripe tip claims before removing the atomic finalizer';
  end if;
end $$;
drop function if exists public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb);
