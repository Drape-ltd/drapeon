begin;

do $$
declare
  v_signature text;
  v_trigger_name text;
  v_table_name text;
  v_fn regprocedure;
  v_trigger_count integer;
  v_is_trigger boolean;
  v_safe_path boolean;
  v_security_definer boolean;
begin
  for v_signature, v_trigger_name, v_table_name in
    select * from (values
      ('public.prevent_consultation_money_claim_identity_change()', 'consultation_money_claim_identity_immutable', 'public.consultation_money_operation_claims'),
      ('public.guard_consultation_payout_exact_payment()', 'consultation_payout_exact_payment_guard', 'public.consultation_money_operation_claims'),
      ('public.block_consultation_payout_during_refund_hold()', 'consultation_payout_refund_hold_guard', 'public.consultation_money_operation_claims'),
      ('public.bind_consultation_refund_claim_payment()', 'consultation_refund_claim_payment_binding', 'public.consultation_money_operation_claims'),
      ('public.require_review_for_post_payout_consultation_refund()', 'require_review_for_post_payout_consultation_refund', 'public.consultation_money_operation_claims'),
      ('public.wait_for_consultation_payout_receipt_before_refund()', 'wait_for_consultation_payout_receipt_before_refund', 'public.consultation_money_operation_claims'),
      ('public.prevent_adjustment_money_claim_identity_change()', 'adjustment_money_claim_identity_immutable', 'public.adjustment_money_operation_claims'),
      ('public.guard_consultation_refund_hold_identity()', 'consultation_refund_hold_identity_immutable', 'public.consultation_refund_holds')
    ) as expected(signature, trigger_name, table_name)
  loop
    v_fn := to_regprocedure(v_signature);
    if v_fn is null then
      raise exception 'Expected claim guard function % is missing', v_signature;
    end if;

    select p.prorettype = 'trigger'::regtype,
      p.prosecdef,
      p.proconfig @> array['search_path=""']
    into v_is_trigger, v_security_definer, v_safe_path
    from pg_proc p where p.oid = v_fn;
    if not v_is_trigger or v_security_definer or not v_safe_path then
      raise exception '% must be an invoker trigger function with an empty search_path', v_signature;
    end if;

    if has_function_privilege('anon', v_fn, 'EXECUTE')
      or has_function_privilege('authenticated', v_fn, 'EXECUTE')
      or has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '% must not be directly executable by API roles', v_signature;
    end if;

    select count(*) into v_trigger_count
    from pg_trigger t
    where t.tgfoid = v_fn
      and t.tgname = v_trigger_name
      and t.tgrelid = v_table_name::regclass
      and not t.tgisinternal
      and t.tgenabled = 'O';
    if v_trigger_count <> 1 then
      raise exception 'Expected enabled trigger %.% for %', v_table_name, v_trigger_name, v_signature;
    end if;
  end loop;
end;
$$;

-- Exercise the consultation identity/status guard with isolated fixture rows.
create temporary table qa_consultation_claim_guard (
  booking_id uuid,
  operation_kind text,
  request_key text,
  amount integer,
  currency text,
  refund_funding_mode text,
  money_desk_request_id uuid,
  payment_id uuid,
  status text,
  updated_at timestamptz
);
create trigger qa_consultation_claim_guard
  before update on qa_consultation_claim_guard
  for each row execute function public.prevent_consultation_money_claim_identity_change();
insert into qa_consultation_claim_guard values
  (gen_random_uuid(), 'PAYOUT', 'qa-consultation-claim', 100, 'GBP', null, null, null, 'RESERVED', now());

do $$
begin
  update qa_consultation_claim_guard set status='PROVIDER_PENDING';
  begin
    update qa_consultation_claim_guard set status='RESERVED';
    raise exception 'Consultation claim status rollback unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Consultation money operation status cannot move backwards' then raise; end if;
  end;
  begin
    update qa_consultation_claim_guard set amount=101;
    raise exception 'Consultation claim identity rewrite unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Consultation money operation identity cannot change' then raise; end if;
  end;
end;
$$;

-- Exercise adjustment identity immutability without touching an actual claim.
create temporary table qa_adjustment_claim_guard (
  adjustment_id uuid,
  source_payment_id uuid,
  capture_transaction_id uuid,
  operation_kind text,
  request_key text,
  amount integer,
  currency text,
  money_desk_request_id uuid,
  refund_funding_mode text,
  payout_claim_id uuid,
  updated_at timestamptz
);
create trigger qa_adjustment_claim_guard
  before update on qa_adjustment_claim_guard
  for each row execute function public.prevent_adjustment_money_claim_identity_change();
insert into qa_adjustment_claim_guard values
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'PAYOUT', 'qa-adjustment-claim', 100, 'GBP', gen_random_uuid(), null, gen_random_uuid(), now());

do $$
begin
  begin
    update qa_adjustment_claim_guard set amount=101;
    raise exception 'Adjustment claim identity rewrite unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Adjustment money operation identity cannot change' then raise; end if;
  end;
end;
$$;

-- A resolved ambiguity hold must remain resolved.
create temporary table qa_consultation_refund_hold_guard (
  payment_id uuid,
  order_id text,
  amount integer,
  currency text,
  ops_issue_id uuid,
  status text,
  updated_at timestamptz
);
create trigger qa_consultation_refund_hold_guard
  before update on qa_consultation_refund_hold_guard
  for each row execute function public.guard_consultation_refund_hold_identity();
insert into qa_consultation_refund_hold_guard values
  (gen_random_uuid(), 'qa-order', 100, 'GBP', gen_random_uuid(), 'RESOLVED', now());

do $$
begin
  begin
    update qa_consultation_refund_hold_guard set status='OPEN';
    raise exception 'Resolved consultation hold reopened unexpectedly';
  exception when raise_exception then
    if sqlerrm <> 'Resolved consultation refund hold cannot reopen' then raise; end if;
  end;
end;
$$;

rollback;
