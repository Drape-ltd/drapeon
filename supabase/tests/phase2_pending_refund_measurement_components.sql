-- Rollback-only coverage for pending refund work in the Ops exposure view.
begin;

insert into public.money_desk_jit_grants (
  id,actor_email,actor_subject,actor_role,assurance_source,action_scopes,reason,expires_at
) values (
  'a1050000-0000-4000-8000-000000000001','phase2-pending-refund@example.invalid',
  'qa-pending-refund','FINANCE','MIGRATION_DRY_RUN',array['CUSTOMER_REFUND']::text[],
  'Rollback-only pending refund measurement fixture',now() + interval '1 minute'
);

insert into public.money_desk_requests (
  id,idempotency_key,request_hash,action_type,status,target_type,target_id,order_id,
  amount,currency,reason,requester_email,requester_subject,requester_role,
  requester_jit_grant_id,risk_level,required_approval_count
) values (
  'a1050000-0000-4000-8000-000000000002','qa:phase2-pending-refund:one','qa-pending-refund-hash',
  'CUSTOMER_REFUND','PENDING_APPROVAL','ORDER','unlinked-qa-order',null,450,'USD',
  'Rollback-only pending refund measurement fixture','phase2-pending-refund@example.invalid',
  'qa-pending-refund','FINANCE','a1050000-0000-4000-8000-000000000001','STANDARD',1
);

set local role service_role;

do $test$
declare
  v_component record;
begin
  select * into v_component
  from public.payout_account_pending_refund_components
  where component_type = 'MONEY_DESK_REFUND_REQUEST'
    and component_status = 'PENDING_APPROVAL'
    and link_quality = 'UNLINKED'
    and currency = 'USD';

  if v_component.refund_component_count <> 1
    or v_component.refund_amount_minor <> 450
    or v_component.payment_phase <> 'UNRESOLVED'
    or v_component.route_key <> 'LEGACY_OR_UNSNAPSHOTTED' then
    raise exception 'Pending unlinked refund request was not measured as an unresolved component';
  end if;

  if has_table_privilege('anon', 'public.payout_account_pending_refund_components', 'SELECT')
    or has_table_privilege('authenticated', 'public.payout_account_pending_refund_components', 'SELECT') then
    raise exception 'Pending refund view must not be readable by public API roles';
  end if;
  if not has_table_privilege('service_role', 'public.payout_account_pending_refund_components', 'SELECT') then
    raise exception 'Ops service role must read the pending refund view';
  end if;

  raise notice 'PASS: pending refund component, unresolved link, amount, and view permissions';
end
$test$;

rollback;
