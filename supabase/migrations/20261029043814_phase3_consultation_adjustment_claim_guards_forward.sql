-- Restore the Dev-verified identity and eligibility guards for consultation
-- and tailor-adjustment money claims. These claim tables were added to
-- Production before their guard functions and trigger bindings. Every route
-- remains disabled until the separately approved Edge and route releases.

CREATE OR REPLACE FUNCTION public.bind_consultation_refund_claim_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
declare
  v_booking public.consultation_bookings%rowtype;
  v_payment public.order_payments%rowtype;
  v_payment_ids uuid[];
begin
  if new.operation_kind <> 'REFUND' then return new; end if;

  select * into v_booking
  from public.consultation_bookings where id = new.booking_id;

  select array_agg(id order by id) into v_payment_ids
  from public.order_payments
  where consultation_booking_id = new.booking_id
    and phase = 'CONSULTATION'
    and status in ('SUCCEEDED','PARTIAL_REFUND');

  if coalesce(cardinality(v_payment_ids), 0) <> 1 then
    raise exception 'CONSULTATION_REFUND_PAYMENT_IDENTITY_UNRESOLVED';
  end if;

  new.payment_id := v_payment_ids[1];
  select * into v_payment from public.order_payments where id = new.payment_id;

  if v_payment.order_id <> v_booking.order_id
    or v_payment.currency <> new.currency
    or v_payment.amount <> v_booking.fee_amount
    or v_payment.amount - coalesce(v_payment.refunded_amount, 0) < new.amount
    or exists (
      select 1 from public.order_payments competing
      where competing.id <> v_payment.id
        and competing.order_id = v_booking.order_id
        and competing.phase = 'CONSULTATION'
        and competing.status = 'SUCCEEDED'
        and competing.consultation_booking_id is null
        and competing.amount = v_payment.amount
        and competing.currency = v_payment.currency
    ) then
    raise exception 'CONSULTATION_REFUND_PAYMENT_IDENTITY_CONFLICT';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.block_consultation_payout_during_refund_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
declare
  v_booking public.consultation_bookings%rowtype;
begin
  if new.operation_kind not in ('PAYOUT','REFUND') then return new; end if;

  select * into v_booking
  from public.consultation_bookings
  where id = new.booking_id
  for update;

  if exists (
    select 1 from public.consultation_refund_holds h
    where h.order_id = v_booking.order_id
      and h.amount = v_booking.fee_amount
      and h.currency = v_booking.fee_currency
      and h.status = 'OPEN'
  ) then
    raise exception 'CONSULTATION_REFUND_UNDER_REVIEW';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_consultation_payout_exact_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
declare
  v_booking public.consultation_bookings%rowtype;
  v_exact_count integer;
begin
  if new.operation_kind <> 'PAYOUT' then return new; end if;

  select * into v_booking
  from public.consultation_bookings
  where id = new.booking_id
  for update;

  if not found or v_booking.payment_status <> 'PAID'
    or v_booking.earned_amount is distinct from new.amount
    or v_booking.fee_currency is distinct from new.currency then
    raise exception 'Consultation payout claim lacks its accepted booking terms';
  end if;

  select count(*) into v_exact_count
  from public.order_payments p
  where p.consultation_booking_id = new.booking_id
    and p.order_id = v_booking.order_id
    and p.phase = 'CONSULTATION'
    and p.status = 'SUCCEEDED'
    and p.amount = v_booking.fee_amount
    and p.currency = v_booking.fee_currency
    and coalesce(p.refunded_amount, 0) = 0
    and pg_catalog.lower(coalesce(
      p.provider_response #>> '{latest_refund_request,response,status}', ''
    )) not in ('pending','processing','needs-attention','requires_action');

  if v_exact_count <> 1 or exists (
    select 1 from public.order_payments p
    where p.consultation_booking_id is null
      and p.order_id = v_booking.order_id
      and p.phase = 'CONSULTATION'
      and p.status = 'SUCCEEDED'
      and p.amount = v_booking.fee_amount
      and p.currency = v_booking.fee_currency
  ) then
    raise exception 'Consultation payout claim needs one exact unrefunded booking payment';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_adjustment_money_claim_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
begin
  if row(new.adjustment_id, new.source_payment_id, new.capture_transaction_id,
      new.operation_kind, new.request_key, new.amount, new.currency,
      new.money_desk_request_id, new.refund_funding_mode, new.payout_claim_id)
    is distinct from
    row(old.adjustment_id, old.source_payment_id, old.capture_transaction_id,
      old.operation_kind, old.request_key, old.amount, old.currency,
      old.money_desk_request_id, old.refund_funding_mode, old.payout_claim_id) then
    raise exception 'Adjustment money operation identity cannot change';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_consultation_money_claim_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
begin
  if row(new.booking_id, new.operation_kind, new.request_key, new.amount,
      new.currency, new.refund_funding_mode, new.money_desk_request_id, new.payment_id)
    is distinct from
    row(old.booking_id, old.operation_kind, old.request_key, old.amount,
      old.currency, old.refund_funding_mode, old.money_desk_request_id, old.payment_id) then
    raise exception 'Consultation money operation identity cannot change';
  end if;

  if (old.status = 'SUCCEEDED' and new.status <> 'SUCCEEDED')
    or (old.status <> 'RESERVED' and new.status = 'RESERVED') then
    raise exception 'Consultation money operation status cannot move backwards';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.require_review_for_post_payout_consultation_refund()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
begin
  if new.operation_kind = 'REFUND'
    and new.refund_funding_mode = 'POST_PAYOUT'
    and new.money_desk_request_id is null then
    raise exception 'CONSULTATION_POST_PAYOUT_REVIEW_REQUIRED';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.wait_for_consultation_payout_receipt_before_refund()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
declare
  v_booking public.consultation_bookings%rowtype;
begin
  if new.operation_kind <> 'REFUND'
    or new.refund_funding_mode <> 'POST_PAYOUT' then
    return new;
  end if;

  select * into v_booking
  from public.consultation_bookings
  where id = new.booking_id
  for update;

  if v_booking.payout_id is null
    or v_booking.settlement_status <> 'RELEASED'
    or not exists (
      select 1
      from public.payouts p
      join public.commercial_ledger_transactions l
        on l.provider_reference = p.provider_payout_id
       and l.purpose = 'CONSULTATION_RELEASE'
       and l.payment_id = p.source_payment_id
      where p.id = v_booking.payout_id
        and p.consultation_booking_id = new.booking_id
        and p.payout_purpose = 'CONSULTATION_EARNING'
        and p.amount = v_booking.earned_amount
        and p.currency = v_booking.fee_currency
    ) then
    raise exception 'CONSULTATION_PAYOUT_RECEIPT_PENDING';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_consultation_refund_hold_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
begin
  if row(new.payment_id, new.order_id, new.amount, new.currency, new.ops_issue_id)
    is distinct from
    row(old.payment_id, old.order_id, old.amount, old.currency, old.ops_issue_id) then
    raise exception 'Consultation refund hold identity cannot change';
  end if;

  if old.status = 'RESOLVED' and new.status <> 'RESOLVED' then
    raise exception 'Resolved consultation refund hold cannot reopen';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.bind_consultation_refund_claim_payment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_consultation_payout_during_refund_hold() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_consultation_payout_exact_payment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_adjustment_money_claim_identity_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_consultation_money_claim_identity_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.require_review_for_post_payout_consultation_refund() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wait_for_consultation_payout_receipt_before_refund() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_consultation_refund_hold_identity() FROM PUBLIC, anon, authenticated, service_role;

DO $install_claim_triggers$
DECLARE
  v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.consultation_money_operation_claims'::regclass
    AND t.tgname = 'consultation_money_claim_identity_immutable'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER consultation_money_claim_identity_immutable
      BEFORE UPDATE ON public.consultation_money_operation_claims
      FOR EACH ROW EXECUTE FUNCTION public.prevent_consultation_money_claim_identity_change();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER consultation_money_claim_identity_immutable BEFORE UPDATE ON consultation_money_operation_claims FOR EACH ROW EXECUTE FUNCTION prevent_consultation_money_claim_identity_change()' THEN
    RAISE EXCEPTION 'Unexpected consultation money claim identity trigger definition';
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.consultation_money_operation_claims'::regclass
    AND t.tgname = 'consultation_payout_exact_payment_guard'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER consultation_payout_exact_payment_guard
      BEFORE INSERT ON public.consultation_money_operation_claims
      FOR EACH ROW EXECUTE FUNCTION public.guard_consultation_payout_exact_payment();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER consultation_payout_exact_payment_guard BEFORE INSERT ON consultation_money_operation_claims FOR EACH ROW EXECUTE FUNCTION guard_consultation_payout_exact_payment()' THEN
    RAISE EXCEPTION 'Unexpected consultation exact payment trigger definition';
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.consultation_money_operation_claims'::regclass
    AND t.tgname = 'consultation_payout_refund_hold_guard'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER consultation_payout_refund_hold_guard
      BEFORE INSERT ON public.consultation_money_operation_claims
      FOR EACH ROW EXECUTE FUNCTION public.block_consultation_payout_during_refund_hold();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER consultation_payout_refund_hold_guard BEFORE INSERT ON consultation_money_operation_claims FOR EACH ROW EXECUTE FUNCTION block_consultation_payout_during_refund_hold()' THEN
    RAISE EXCEPTION 'Unexpected consultation refund hold trigger definition';
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.consultation_money_operation_claims'::regclass
    AND t.tgname = 'consultation_refund_claim_payment_binding'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER consultation_refund_claim_payment_binding
      BEFORE INSERT ON public.consultation_money_operation_claims
      FOR EACH ROW EXECUTE FUNCTION public.bind_consultation_refund_claim_payment();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER consultation_refund_claim_payment_binding BEFORE INSERT ON consultation_money_operation_claims FOR EACH ROW EXECUTE FUNCTION bind_consultation_refund_claim_payment()' THEN
    RAISE EXCEPTION 'Unexpected consultation refund payment binding trigger definition';
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.consultation_money_operation_claims'::regclass
    AND t.tgname = 'require_review_for_post_payout_consultation_refund'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER require_review_for_post_payout_consultation_refund
      BEFORE INSERT ON public.consultation_money_operation_claims
      FOR EACH ROW EXECUTE FUNCTION public.require_review_for_post_payout_consultation_refund();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER require_review_for_post_payout_consultation_refund BEFORE INSERT ON consultation_money_operation_claims FOR EACH ROW EXECUTE FUNCTION require_review_for_post_payout_consultation_refund()' THEN
    RAISE EXCEPTION 'Unexpected post-payout review trigger definition';
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.consultation_money_operation_claims'::regclass
    AND t.tgname = 'wait_for_consultation_payout_receipt_before_refund'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER wait_for_consultation_payout_receipt_before_refund
      BEFORE INSERT ON public.consultation_money_operation_claims
      FOR EACH ROW EXECUTE FUNCTION public.wait_for_consultation_payout_receipt_before_refund();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER wait_for_consultation_payout_receipt_before_refund BEFORE INSERT ON consultation_money_operation_claims FOR EACH ROW EXECUTE FUNCTION wait_for_consultation_payout_receipt_before_refund()' THEN
    RAISE EXCEPTION 'Unexpected consultation payout receipt trigger definition';
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.adjustment_money_operation_claims'::regclass
    AND t.tgname = 'adjustment_money_claim_identity_immutable'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER adjustment_money_claim_identity_immutable
      BEFORE UPDATE ON public.adjustment_money_operation_claims
      FOR EACH ROW EXECUTE FUNCTION public.prevent_adjustment_money_claim_identity_change();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER adjustment_money_claim_identity_immutable BEFORE UPDATE ON adjustment_money_operation_claims FOR EACH ROW EXECUTE FUNCTION prevent_adjustment_money_claim_identity_change()' THEN
    RAISE EXCEPTION 'Unexpected adjustment money claim identity trigger definition';
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.consultation_refund_holds'::regclass
    AND t.tgname = 'consultation_refund_hold_identity_immutable'
    AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    CREATE TRIGGER consultation_refund_hold_identity_immutable
      BEFORE UPDATE ON public.consultation_refund_holds
      FOR EACH ROW EXECUTE FUNCTION public.guard_consultation_refund_hold_identity();
  ELSIF v_actual IS DISTINCT FROM 'CREATE TRIGGER consultation_refund_hold_identity_immutable BEFORE UPDATE ON consultation_refund_holds FOR EACH ROW EXECUTE FUNCTION guard_consultation_refund_hold_identity()' THEN
    RAISE EXCEPTION 'Unexpected consultation refund hold identity trigger definition';
  END IF;
END;
$install_claim_triggers$;
