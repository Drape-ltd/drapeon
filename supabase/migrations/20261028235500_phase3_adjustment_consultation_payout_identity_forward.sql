-- Restore the Phase 1 payout identity fields before their claim guards/RPCs.
-- This is additive on Production and already present in Dev.
alter table public.commercial_adjustments
  add column if not exists tailor_release_policy_version text;
do $$ begin
if not exists (select 1 from pg_constraint
  where conrelid='public.commercial_adjustments'::regclass
    and conname='commercial_adjustments_tailor_release_policy_check') then
alter table public.commercial_adjustments
  add constraint commercial_adjustments_tailor_release_policy_check check (
    tailor_release_policy_version is null or (
      tailor_release_policy_version = 'tailor-adjustment-delivery-72h-reviewed-v1'
      and requires_payment and amount_delta > 0
      and responsibility = 'CUSTOMER'
      and adjustment_type in ('SCOPE','RUSH_WORK','FIT_REVISION','CORRECTION','OTHER_REVIEWED')
    )
  );
end if;
end $$;

alter table public.payouts
  add column if not exists consultation_booking_id uuid
    references public.consultation_bookings(id) on delete restrict;
alter table public.payouts
  add column if not exists tailor_adjustment_id uuid
    references public.commercial_adjustments(id) on delete restrict;
do $$ begin
if not exists (select 1 from pg_constraint
  where conrelid='public.payouts'::regclass
    and conname='payouts_payout_purpose_check'
    and pg_get_constraintdef(oid) like '%TAILOR_ADJUSTMENT%') then
alter table public.payouts drop constraint payouts_payout_purpose_check;
alter table public.payouts add constraint payouts_payout_purpose_check check (payout_purpose in (
    'ORDER_EARNING','SETTLEMENT_TRANCHE','FABRIC_RELEASE',
    'MATERIAL_ADVANCE','CONSULTATION_EARNING','TIP','RESIDUAL_SETTLEMENT',
    'TAILOR_ADJUSTMENT'
  ));
end if;
end $$;
do $$ begin
if not exists (select 1 from pg_constraint
  where conrelid='public.payouts'::regclass
    and conname='payouts_tailor_adjustment_purpose_check') then
alter table public.payouts add constraint payouts_tailor_adjustment_purpose_check check (
    (payout_purpose='TAILOR_ADJUSTMENT')=(tailor_adjustment_id is not null)
  );
end if;
end $$;
create unique index if not exists payouts_one_tailor_adjustment_idx
  on public.payouts(tailor_adjustment_id)
  where tailor_adjustment_id is not null;
create unique index if not exists payouts_one_consultation_booking_idx
  on public.payouts(consultation_booking_id)
  where consultation_booking_id is not null;
