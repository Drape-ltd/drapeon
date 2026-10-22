-- Revert only after Edge rollout is reverted. Never discard an unresolved
-- provider-confirmed full tip refund merely to remove this repair path.
do $$
begin
  if exists (select 1 from public.tip_money_operation_claims c
    join public.order_tips t on t.id=c.tip_id
    where c.operation_kind='REFUND' and c.status='SUCCEEDED'
      and c.refund_funding_mode='POST_PAYOUT' and t.status<>'REFUNDED') then
    raise exception 'Provider-confirmed tip refunds need reconciliation before rollback';
  end if;
end $$;
drop function public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb);
alter function public.finalize_claimed_stripe_tip_payout_core(uuid,uuid,text,text,jsonb)
  rename to finalize_claimed_stripe_tip_payout;
