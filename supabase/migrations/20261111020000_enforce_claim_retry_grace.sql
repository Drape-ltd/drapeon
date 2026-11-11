-- Give Stripe time to deliver a late success after a definite not-sent
-- reconciliation before a new reviewed operation can be reserved.
create function public.enforce_payout_claim_retry_grace()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_confirmed_at timestamptz;
begin
  select op.funds_return_confirmed_at into v_confirmed_at
    from public.payout_provider_operations op
    where op.id = new.prior_operation_id
      and op.claim_id = new.claim_id
      and op.status = 'FAILED_RETURNED'
      and op.funds_return_reference like 'NOT_SENT:%';
  if v_confirmed_at is null
    or v_confirmed_at > now() - interval '10 minutes' then
    raise exception 'Claimed payout retry grace period has not elapsed';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_payout_claim_retry_grace()
  from public, anon, authenticated;
grant execute on function public.enforce_payout_claim_retry_grace() to service_role;

create trigger enforce_payout_claim_retry_grace_before_insert
before insert on public.payout_claim_retry_authorizations
for each row execute function public.enforce_payout_claim_retry_grace();
