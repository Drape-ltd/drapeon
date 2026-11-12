do $rehearsal$
declare
  phase text := current_setting('drape.pay003_rehearsal_phase');
  expected_payment_id uuid := '73000000-0000-4000-8000-000000000002';
  snapshot_oid oid := to_regprocedure(
    'public.snapshot_ready_made_payment_route(text,uuid,uuid,integer,uuid,integer,uuid,text,text)'
  );
begin
  if phase = 'baseline' then
    if to_regclass('public.payment_status_transition_audits') is not null
       or to_regclass('public.order_payment_provider_refunds') is not null
       or to_regclass('public.payment_late_success_refund_operations') is not null
       or to_regprocedure('public.apply_order_payment_status_transition(public.payment_provider,text,public.order_payment_status,jsonb,text,boolean)') is not null then
      raise exception 'PAY-003 objects leaked from a rolled-back migration';
    end if;
    if (select count(*) from public.orders) <> 1
       or (select count(*) from public.order_payments) <> 1
       or (select refunded_amount from public.order_payments where id = expected_payment_id) <> 250 then
      raise exception 'baseline fixture changed during rollback';
    end if;
    if (select prosecdef from pg_proc where oid = snapshot_oid)
       or not (select proconfig @> array['search_path=public'] from pg_proc where oid = snapshot_oid)
       or not has_function_privilege('service_role', snapshot_oid, 'EXECUTE')
       or has_function_privilege('anon', snapshot_oid, 'EXECUTE')
       or has_function_privilege('authenticated', snapshot_oid, 'EXECUTE') then
      raise exception 'baseline snapshot function security state was not restored';
    end if;
  elsif phase = 'rollback_1b' then
    if to_regclass('public.payment_status_transition_audits') is not null
       or to_regclass('public.order_payment_provider_refunds') is not null
       or to_regclass('public.payment_late_success_refund_operations') is not null
       or to_regprocedure('public.apply_order_payment_status_transition(public.payment_provider,text,public.order_payment_status,jsonb,text,boolean)') is not null
       or exists (select 1 from pg_trigger where tgrelid='public.order_payments'::regclass and tgname='order_payment_forward_status_guard')
       or exists (select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='order_payment_backed_advancement_guard') then
      raise exception '1b objects or triggers leaked from a rolled-back transaction';
    end if;
    if (select count(*) from public.orders) <> 1
       or (select count(*) from public.order_payments) <> 1
       or (select refunded_amount from public.order_payments where id = expected_payment_id) <> 250 then
      raise exception '1b rollback changed the baseline fixture';
    end if;
  elsif phase = 'rollback_1b4' then
    if pg_get_function_arguments('public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure)
       <> 'p_refund_claim_id uuid, p_provider_refund_id text, p_failure_evidence jsonb' then
      raise exception '1b refund-failure migration rollback did not restore its predecessor signature';
    end if;
  elsif phase = 'a1' then
    if not (select prosecdef from pg_proc where oid = snapshot_oid)
       or not (select proconfig @> array['search_path=""'] from pg_proc where oid = snapshot_oid)
       or (select pg_get_userbyid(proowner) from pg_proc where oid = snapshot_oid) <> 'postgres'
       or not has_function_privilege('service_role', snapshot_oid, 'EXECUTE')
       or has_function_privilege('anon', snapshot_oid, 'EXECUTE')
       or has_function_privilege('authenticated', snapshot_oid, 'EXECUTE') then
      raise exception '1a snapshot function owner, security mode, search_path, or grants are wrong';
    end if;
  elsif phase = 'a1b' then
    if to_regclass('public.payment_status_transition_audits') is null
       or to_regclass('public.order_payment_provider_refunds') is null
       or to_regclass('public.payment_late_success_refund_operations') is null
       or to_regprocedure('public.apply_order_payment_status_transition(public.payment_provider,text,public.order_payment_status,jsonb,text,boolean)') is null
       or not exists (select 1 from pg_trigger where tgrelid='public.order_payments'::regclass and tgname='order_payment_forward_status_guard' and tgenabled <> 'D')
       or not exists (select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='order_payment_backed_advancement_guard' and tgenabled <> 'D') then
      raise exception '1b required PAY-003 objects or triggers are absent';
    end if;
    if not (select relrowsecurity from pg_class where oid='public.payment_status_transition_audits'::regclass)
       or has_table_privilege('anon','public.payment_status_transition_audits','SELECT')
       or has_table_privilege('authenticated','public.payment_status_transition_audits','INSERT')
       or not has_table_privilege('service_role','public.payment_status_transition_audits','SELECT')
       or not has_table_privilege('service_role','public.payment_status_transition_audits','INSERT') then
      raise exception '1b transition-audit RLS or grants are wrong';
    end if;
    if pg_get_function_arguments('public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure)
       <> 'p_refund_claim_id uuid, p_provider_refund_id text, p_failure_evidence jsonb' then
      raise exception '30000 refund function signature differs from its source';
    end if;
  elsif phase = 'a1b4' then
    if pg_get_function_arguments('public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure)
       <> 'p_payment_id uuid, p_provider_refund_id text, p_failure_evidence jsonb'
       or position('CONFIRMED_REFUND_ROW_NOT_FOUND' in pg_get_functiondef('public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure)) = 0
       or not has_function_privilege('service_role','public.reconcile_failed_order_payment_refund(uuid,text,jsonb)','EXECUTE')
       or has_function_privilege('anon','public.reconcile_failed_order_payment_refund(uuid,text,jsonb)','EXECUTE') then
      raise exception '1b refund-failure replacement signature, body, or grants are wrong';
    end if;
  elsif phase = 'a1c' then
    if (select count(*) from public.order_payment_provider_refunds) <> 1
       or not exists (
         select 1 from public.order_payment_provider_refunds
         where payment_id=expected_payment_id and provider_refund_id='LEGACY-' || expected_payment_id::text
           and amount=250 and status='CONFIRMED'
           and provider_response->>'source'='PAY003_LEGACY_BASELINE'
       ) then
      raise exception '1c did not create exactly the expected legacy refund baseline';
    end if;
  elsif phase = 'rollback_1c' then
    if (select count(*) from public.order_payment_provider_refunds) <> 0 then
      raise exception '1c rollback left a baseline row behind';
    end if;
  elsif phase = 'a1d' then
    if position('PAYMENT_REFUNDED_AMOUNT_OUT_OF_RANGE' in pg_get_functiondef('public.guard_order_payment_forward_status()'::regprocedure)) = 0
       or position('REFUND_FAILURE_AGGREGATE_INVALID' in pg_get_functiondef('public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure)) = 0
       or to_regprocedure('public.record_bachs_payment_refund_attempt_outcome(uuid,text,text,jsonb)') is null
       or not has_function_privilege('service_role','public.record_bachs_payment_refund_attempt_outcome(uuid,text,text,jsonb)','EXECUTE')
       or has_function_privilege('anon','public.record_bachs_payment_refund_attempt_outcome(uuid,text,text,jsonb)','EXECUTE') then
      raise exception '1d hardened PAY-003 function body or grants are wrong';
    end if;
  else
    raise exception 'unknown rehearsal phase: %', phase;
  end if;
end;
$rehearsal$;
