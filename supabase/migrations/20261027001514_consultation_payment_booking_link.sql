-- Bind every consultation payment attempt to its immutable booking and use
-- the booking row as the atomic refund-vs-payout claim.

alter table public.order_payments
  add column if not exists consultation_booking_id uuid
    references public.consultation_bookings(id) on delete restrict,
  add column if not exists consultation_booking_link_source text;

alter table public.order_payments
  drop constraint if exists order_payments_consultation_booking_link_source_check;
alter table public.order_payments
  add constraint order_payments_consultation_booking_link_source_check
  check (
    consultation_booking_link_source is null
    or consultation_booking_link_source in ('PREPARED', 'BACKFILL')
  );

alter table public.order_payments
  drop constraint if exists order_payments_consultation_booking_link_pair_check;
alter table public.order_payments
  add constraint order_payments_consultation_booking_link_pair_check
  check (
    (consultation_booking_id is null and consultation_booking_link_source is null)
    or (consultation_booking_id is not null and consultation_booking_link_source is not null)
  );

create index if not exists order_payments_consultation_booking_idx
  on public.order_payments (consultation_booking_id, status, created_at desc)
  where phase = 'CONSULTATION' and consultation_booking_id is not null;

comment on column public.order_payments.consultation_booking_id is
  'Exact consultation booking charged by this attempt; webhook metadata is never used to guess the booking.';
comment on column public.order_payments.consultation_booking_link_source is
  'PREPARED for newly linked attempts; BACKFILL for an unambiguous historical order/amount/currency match.';

create or replace function public.claim_consultation_money_action(
  p_booking_id uuid,
  p_action text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.consultation_bookings%rowtype;
  v_successful_attempts integer;
  v_open_reviews integer;
  v_open_refunds integer;
begin
  if p_action not in ('PAYOUT', 'REFUND') then
    raise exception 'Unsupported consultation money action.' using errcode = '22023';
  end if;

  select * into v_booking
  from public.consultation_bookings
  where id = p_booking_id
  for update;

  if not found then return 'NOT_FOUND'; end if;

  if p_action = 'PAYOUT' then
    if v_booking.settlement_status = 'RELEASED' then return 'ALREADY_RELEASED'; end if;
    if v_booking.settlement_status = 'RELEASE_PENDING' then return 'PAYOUT_IN_PROGRESS'; end if;
    if v_booking.settlement_status in ('REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'OPS_REVIEW')
      or v_booking.payment_status in ('PARTIALLY_REFUNDED', 'REFUNDED')
      or coalesce(v_booking.refunded_amount, 0) > 0 then
      return 'REFUND_REVIEW';
    end if;
    if v_booking.settlement_status not in ('EARNED', 'FAILED')
      or v_booking.payment_status <> 'PAID'
      or coalesce(v_booking.earned_amount, 0) <= 0 then
      return 'NOT_ELIGIBLE';
    end if;

    select count(*) into v_successful_attempts
    from public.order_payments payment
    where payment.consultation_booking_id = p_booking_id
      and payment.phase = 'CONSULTATION'
      and payment.status::text = 'SUCCEEDED'
      and coalesce(payment.refunded_amount, 0) = 0;
    if v_successful_attempts <> 1 then return 'PAYMENT_LINK_REQUIRED'; end if;

    select count(*) into v_open_reviews
    from public.consultation_attendance_reviews review
    where review.booking_id = p_booking_id
      and review.status in ('COUNTERPARTY_REVIEW', 'OPS_REVIEW');
    if v_open_reviews > 0 then return 'ATTENDANCE_REVIEW'; end if;

    select count(*) into v_open_refunds
    from public.order_refund_resolutions resolution
    where resolution.order_id::text = v_booking.order_id::text
      and resolution.consultation_amount > 0
      and resolution.status in ('MONEY_DESK_REQUIRED', 'APPROVAL_PENDING', 'APPROVED', 'PROCESSING', 'BLOCKED');
    if v_open_refunds > 0 then return 'REFUND_REVIEW'; end if;

    update public.consultation_bookings
    set settlement_status = 'RELEASE_PENDING', settlement_failure_reason = null
    where id = p_booking_id
      and settlement_status in ('EARNED', 'FAILED')
      and payment_status = 'PAID'
      and coalesce(refunded_amount, 0) = 0;
    if not found then return 'CLAIM_CONFLICT'; end if;
    return 'CLAIMED';
  end if;

  if v_booking.settlement_status = 'RELEASE_PENDING' then return 'PAYOUT_IN_PROGRESS'; end if;
  if v_booking.settlement_status = 'RELEASED' then return 'POST_PAYOUT_REVIEW'; end if;
  if v_booking.settlement_status in ('REFUND_PENDING', 'OPS_REVIEW', 'PARTIALLY_REFUNDED', 'REFUNDED') then
    return 'ALREADY_IN_REVIEW';
  end if;
  if v_booking.payment_status <> 'PAID' then return 'PAYMENT_NOT_PAID'; end if;
  if v_booking.settlement_status not in ('HELD', 'EARNED', 'FAILED') then return 'NOT_ELIGIBLE'; end if;

  update public.consultation_bookings
  set settlement_status = 'REFUND_PENDING', settlement_failure_reason = null
  where id = p_booking_id
    and settlement_status in ('HELD', 'EARNED', 'FAILED')
    and payment_status = 'PAID';
  if not found then return 'CLAIM_CONFLICT'; end if;
  return 'CLAIMED';
end;
$$;

revoke all on function public.claim_consultation_money_action(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_consultation_money_action(uuid, text) to service_role;

comment on function public.claim_consultation_money_action(uuid, text) is
  'Atomically reserves a consultation booking for refund or payout; the booking row is the shared claim and no provider call occurs while it is locked.';
