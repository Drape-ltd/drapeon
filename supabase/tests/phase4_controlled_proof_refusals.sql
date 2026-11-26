-- Rollback-only Dev proof: an exact disabled route cannot be used for a
-- second order or an altered amount. No provider call or real order is used.
-- payment-action's separate sandbox bypass is locked to the exact Dev host;
-- payment-routes_test.ts asserts it refuses the Production host.
begin;
do $test$
declare v_route record; v_proof uuid; v_error text; v_expired integer;
begin
  select id,version into v_route from public.payment_routes
    where provider='BACHS' and status='DISABLED' and charge_currency='NGN'
    order by version desc limit 1;
  if v_route.id is null or exists(select 1 from public.payment_routes where status='ENABLED') then
    raise exception 'PHASE4_TEST_ROUTE_PRECONDITION';
  end if;
  insert into public.phase4_payment_proofs
    (customer_id,tailor_profile_id,order_id,amount_minor,route_id,route_version,
     expires_at,state,created_by)
  values ('11111111-1111-4111-8111-111111111111','synthetic-tailor',
          'synthetic-proof-order',10000,v_route.id,v_route.version,
          now()+interval '10 minutes','SNAPSHOTTED','ROLLBACK_ONLY_TEST')
  returning id into v_proof;

  begin
    perform public.authorize_phase4_proof_checkout(
      v_proof,'second-order',10000,'NGN','INITIAL_ORDER','NGN_CARD');
    raise exception 'PHASE4_TEST_SECOND_ORDER_WAS_ACCEPTED';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'PHASE4_PROOF_CHECKOUT_REFUSED' then raise; end if;
  end;
  begin
    perform public.authorize_phase4_proof_checkout(
      v_proof,'synthetic-proof-order',10001,'NGN','INITIAL_ORDER','NGN_CARD');
    raise exception 'PHASE4_TEST_ALTERED_AMOUNT_WAS_ACCEPTED';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'PHASE4_PROOF_CHECKOUT_REFUSED' then raise; end if;
  end;
  if (select status from public.payment_routes where id=v_route.id)<>'DISABLED' then
    raise exception 'PHASE4_TEST_ROUTE_CHANGED';
  end if;
  if not public.kill_phase4_payment_proof(v_proof,'ROLLBACK_ONLY_TEST','TEST_KILL_SWITCH') then
    raise exception 'PHASE4_TEST_KILL_FAILED';
  end if;
  if (select state from public.phase4_payment_proofs where id=v_proof)<>'KILLED' or
     (select count(*) from public.phase4_payment_proof_events
       where proof_id=v_proof and event_type='KILLED')<>1 then
    raise exception 'PHASE4_TEST_KILL_NOT_AUDITED';
  end if;
  begin
    delete from public.phase4_payment_proofs where id=v_proof;
    raise exception 'PHASE4_TEST_PROOF_DELETE_ACCEPTED';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'PHASE4_PROOF_APPEND_ONLY' then raise; end if;
  end;
  begin
    update public.phase4_payment_proof_events set reason='tampered'
      where proof_id=v_proof and event_type='KILLED';
    raise exception 'PHASE4_TEST_EVENT_UPDATE_ACCEPTED';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'PHASE4_PROOF_EVENT_APPEND_ONLY' then raise; end if;
  end;
  begin
    delete from public.phase4_payment_proof_events
      where proof_id=v_proof and event_type='KILLED';
    raise exception 'PHASE4_TEST_EVENT_DELETE_ACCEPTED';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'PHASE4_PROOF_EVENT_APPEND_ONLY' then raise; end if;
  end;
  insert into public.phase4_payment_proofs
    (customer_id,tailor_profile_id,order_id,amount_minor,route_id,route_version,
     created_at,expires_at,state,created_by)
  values ('11111111-1111-4111-8111-111111111111','synthetic-tailor',
          'synthetic-expired-order',10000,v_route.id,v_route.version,
          now()-interval '15 minutes',now()-interval '1 minute',
          'ARMED','ROLLBACK_ONLY_TEST')
  returning id into v_proof;
  v_expired:=public.expire_phase4_payment_proofs(1);
  if v_expired<>1 or
     (select state from public.phase4_payment_proofs where id=v_proof)<>'EXPIRED' or
     (select count(*) from public.phase4_payment_proof_events
       where proof_id=v_proof and event_type='EXPIRED')<>1 then
    raise exception 'PHASE4_TEST_EXPIRY_FAILED count=%, state=%, events=%',
      v_expired,(select state from public.phase4_payment_proofs where id=v_proof),
      (select count(*) from public.phase4_payment_proof_events
        where proof_id=v_proof and event_type='EXPIRED');
  end if;
end $test$;
rollback;
