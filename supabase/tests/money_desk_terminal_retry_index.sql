-- Run as one transaction against a real PostgreSQL database; no money state persists.
begin;

do $$
declare
  v_index text;
begin
  select pg_get_indexdef('public.money_desk_requests_one_active_target_idx'::regclass)
    into v_index;
  if v_index not like '%PENDING_APPROVAL%' or v_index not like '%APPROVED%'
      or v_index not like '%EXECUTING%' then
    raise exception 'The active-target index has changed; review the retry contract.';
  end if;
end;
$$;

create temp table md_retry_probe
  (like public.money_desk_requests including defaults including constraints including indexes)
  on commit drop;

insert into md_retry_probe (
  reference, idempotency_key, request_hash, action_type, status, target_type,
  target_id, amount, currency, reason, requester_email, requester_subject,
  requester_role, requester_jit_grant_id, risk_level, required_approval_count, terminal_at
) values (
  'MD-QA-RETRY-0', 'settlement-tranche-release:qa-target', 'qa-hash-0',
  'PAYOUT_RELEASE', 'FAILED', 'SETTLEMENT_TRANCHE', 'qa-target', 8400, 'USD',
  'Rollback-only terminal predecessor', 'qa@example.invalid', 'qa-subject',
  'ADMIN', gen_random_uuid(), 'HIGH', 2, now()
);

insert into md_retry_probe (
  reference, idempotency_key, request_hash, action_type, status, target_type,
  target_id, amount, currency, reason, requester_email, requester_subject,
  requester_role, requester_jit_grant_id, risk_level, required_approval_count
)
select 'MD-QA-RETRY-1', 'settlement-tranche-release:qa-target:after:' || id,
  'qa-hash-1', action_type, 'PENDING_APPROVAL', target_type, target_id, amount,
  currency, 'Rollback-only reviewed replacement', requester_email,
  requester_subject, requester_role, requester_jit_grant_id, risk_level,
  required_approval_count
from md_retry_probe where reference = 'MD-QA-RETRY-0';

do $$
begin
  begin
    insert into md_retry_probe (
      reference, idempotency_key, request_hash, action_type, status, target_type,
      target_id, amount, currency, reason, requester_email, requester_subject,
      requester_role, requester_jit_grant_id, risk_level, required_approval_count
    )
    select 'MD-QA-RETRY-CONFLICT', 'another-active-key', 'qa-hash-2', action_type,
      'PENDING_APPROVAL', target_type, target_id, amount, currency,
      'Rollback-only competing review', requester_email, requester_subject,
      requester_role, requester_jit_grant_id, risk_level, required_approval_count
    from md_retry_probe where reference = 'MD-QA-RETRY-0';
    raise exception 'A second active target review was incorrectly allowed';
  exception when unique_violation then
    null;
  end;
  if (select count(*) from md_retry_probe where status = 'PENDING_APPROVAL') <> 1 then
    raise exception 'The active-target guard did not preserve exactly one review';
  end if;
end;
$$;

select 'PASS: terminal review replaced; duplicate active target blocked' as result;
rollback;
