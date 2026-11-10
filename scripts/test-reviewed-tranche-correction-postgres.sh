#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-tranche-correction-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/reviewed_tranche_correction_isolated_schema.sql" >/dev/null
awk '/^create or replace function payment_internal.tranche_source_payment_available\(/{copy=1} copy{print} copy && /^end \$function\$;/{exit}' \
  "$repo_root/supabase/migrations/20261110042832_allow_accounted_non_tailor_refunds_for_tranches.sql" |
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/rollback/20261110120000_allow_reviewed_tranche_destination_correction.rollback.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create trigger a0_claimed_replacement_refund_race_guard
before insert on public.payout_provider_operations
for each row execute function public.guard_claimed_replacement_against_refund();
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/reviewed_tranche_correction_behavior.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $test$
begin
  if public.try_correction(2) not like '%Replacement funding route is not proven%' then
    raise exception 'Main did not reject the failed settlement-tranche correction';
  end if;
  if public.try_order_earning(2) <> 'ALLOWED' then
    raise exception 'Main order-earning replacement fixture is invalid';
  end if;
  raise notice 'RED: main blocks the reviewed settlement-tranche correction';
end;
$test$;
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261110120000_allow_reviewed_tranche_destination_correction.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $test$
begin
  if not payment_internal.tranche_source_payment_available(
      '81000000-0000-4000-8000-000000000010',
      '81000000-0000-4000-8000-000000000020',
      '81000000-0000-4000-8000-000000000030') then
    raise exception 'Real tranche funding helper rejected the clean payment fixture';
  end if;
  if public.try_correction(2) <> 'ALLOWED' then
    raise exception 'Reviewed tranche correction still cannot reserve operation 2';
  end if;
  if public.try_correction(2) not like '%duplicate key value%' or
    (select count(*) from public.payout_provider_operations
      where claim_id='81000000-0000-4000-8000-000000000040'
        and operation_number=2)<>1 then
    raise exception 'Replayed correction inserted a second provider operation';
  end if;
  if public.try_order_earning(3) <> 'ALLOWED' then
    raise exception 'Existing order-earning replacement path regressed';
  end if;
  raise notice 'GREEN: failed tranche with a clean source accepts correction';
end;
$test$;
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
update public.order_work_funding_positions set status='CANCELED'
  where id='81000000-0000-4000-8000-000000000050';
do $test$
begin
  if public.try_correction(9) not like '%source or funding position is not available%' then
    raise exception 'Missing reserved funding position did not block correction';
  end if;
  raise notice 'GREEN: missing funding reservation blocks correction';
end;
$test$;
update public.order_work_funding_positions set status='RESERVED'
  where id='81000000-0000-4000-8000-000000000050';
update public.order_settlement_tranches set amount=8300
  where id='81000000-0000-4000-8000-000000000030';
do $test$
begin
  if public.try_correction(10) not like '%source or funding position is not available%' then
    raise exception 'Changed tranche amount did not block correction';
  end if;
  raise notice 'GREEN: changed tranche amount blocks correction';
end;
$test$;
update public.order_settlement_tranches set amount=8400
  where id='81000000-0000-4000-8000-000000000030';
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
update public.order_payments set status='PARTIAL_REFUND',refunded_amount=300
  where id='81000000-0000-4000-8000-000000000010';
insert into public.order_payment_provider_refunds(
  id,payment_id,status,provider,provider_refund_id,amount
) values (
  '81000000-0000-4000-8000-000000000070',
  '81000000-0000-4000-8000-000000000010','CONFIRMED','STRIPE',
  're_qa_dispatch',300
);
insert into public.commercial_ledger_transactions(
  id,payment_id,order_id,transaction_kind,purpose,original_amount,
  settlement_amount,original_currency,settlement_currency,
  reversal_of_transaction_id,provider_reference
) values (
  '81000000-0000-4000-8000-000000000071',
  '81000000-0000-4000-8000-000000000010','qa-order','REFUND',
  'DISPATCH_ALLOWANCE',300,300,'USD','USD',
  '81000000-0000-4000-8000-000000000060','re_qa_dispatch'
);
insert into public.commercial_ledger_entries(
  id,transaction_id,direction,account_code,currency,amount
) values
  ('81000000-0000-4000-8000-000000000072',
    '81000000-0000-4000-8000-000000000071','DEBIT',
    'FULFILLMENT_LIABILITY','USD',300),
  ('81000000-0000-4000-8000-000000000073',
    '81000000-0000-4000-8000-000000000071','CREDIT',
    'PROVIDER_CLEARING','USD',300);
do $test$
declare v_available boolean; v_outcome text;
begin
  v_available := payment_internal.tranche_source_payment_available(
      '81000000-0000-4000-8000-000000000010',
      '81000000-0000-4000-8000-000000000020',
      '81000000-0000-4000-8000-000000000030');
  v_outcome := public.try_correction(3);
  if not v_available or v_outcome <> 'ALLOWED' then
    raise exception 'Accounted refund blocked: available %, outcome %',v_available,v_outcome;
  end if;
  raise notice 'GREEN: accounted delivery refund preserves tranche recovery';
end;
$test$;
update public.commercial_ledger_entries set account_code='TAILOR_ENTITLEMENT'
  where id='81000000-0000-4000-8000-000000000072';
do $test$
begin
  if payment_internal.tranche_source_payment_available(
      '81000000-0000-4000-8000-000000000010',
      '81000000-0000-4000-8000-000000000020',
      '81000000-0000-4000-8000-000000000030')
    or public.try_correction(4) not like '%source or funding position is not available%' then
    raise exception 'Tailor-entitlement refund did not block reviewed correction';
  end if;
  raise notice 'GREEN: refund of tailor entitlement blocks correction';
end;
$test$;
update public.commercial_ledger_entries set account_code='FULFILLMENT_LIABILITY'
  where id='81000000-0000-4000-8000-000000000072';
insert into public.order_payment_refund_claims(id,payment_id,status)
values ('81000000-0000-4000-8000-000000000080',
  '81000000-0000-4000-8000-000000000010','PROVIDER_UNKNOWN');
do $test$
begin
  if public.try_correction(5) not like '%wait for refund or dispute review%' then
    raise exception 'Live refund claim did not block correction';
  end if;
  raise notice 'GREEN: live refund claim blocks correction';
end;
$test$;
delete from public.order_payment_refund_claims
  where id='81000000-0000-4000-8000-000000000080';
insert into public.disputes(id,order_id,status)
values ('qa-dispute','qa-order','OPEN');
do $test$
begin
  if public.try_correction(6) not like '%wait for refund or dispute review%' then
    raise exception 'Open dispute did not block correction';
  end if;
  raise notice 'GREEN: open dispute blocks correction';
end;
$test$;
delete from public.disputes where id='qa-dispute';
delete from public.commercial_ledger_entries
  where transaction_id='81000000-0000-4000-8000-000000000071';
delete from public.commercial_ledger_transactions
  where id='81000000-0000-4000-8000-000000000071';
do $test$
begin
  if payment_internal.tranche_source_payment_available(
      '81000000-0000-4000-8000-000000000010',
      '81000000-0000-4000-8000-000000000020',
      '81000000-0000-4000-8000-000000000030')
    or public.try_correction(7) not like '%source or funding position is not available%' then
    raise exception 'Unjournaled provider refund did not block correction';
  end if;
  raise notice 'GREEN: unjournaled refund blocks correction';
end;
$test$;
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/rollback/20261110120000_allow_reviewed_tranche_destination_correction.rollback.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $test$
begin
  if public.try_correction(8) not like '%Replacement funding route is not proven%' then
    raise exception 'Rollback did not restore the live tranche rejection';
  end if;
  raise notice 'PASS rollback restores the exact live guard behavior';
end;
$test$;
SQL
