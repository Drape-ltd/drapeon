#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-tip-recovery-$$"
logs="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$logs"
}
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
run_sql() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1; }

run_sql <"$repo_root/supabase/tests/dev_tip_refund_reconciliation_fixture.sql" >"$logs/schema.log"
if printf "select public.complete_dev_reviewed_tip_refund_reconciliation(null,null,'{}'::jsonb);\n" |
  run_sql >"$logs/red.log" 2>&1; then
  echo 'The recovery function unexpectedly exists before the migration.' >&2
  exit 1
fi
grep -q 'does not exist' "$logs/red.log"
echo 'RED: no reviewed TIP recovery exists on main.'

run_sql <"$repo_root/supabase/migrations/20261111210000_dev_reviewed_tip_refund_reconciliation.sql" >"$logs/migration.log"
cat <<'SQL' | run_sql >"$logs/green.log" 2>&1
do $$
declare
  v_proof jsonb := jsonb_build_object('status','succeeded','refund_id','re_one',
    'payment_intent','pi_one','amount',500,'observed_at',now());
  v_result jsonb;
begin
  begin
    perform public.complete_dev_reviewed_tip_refund_reconciliation(
      '22222222-2222-4222-8222-222222222222',
      '66666666-6666-4666-8666-666666666666',
      v_proof || jsonb_build_object('amount',499));
    raise exception 'wrong provider amount was accepted';
  exception when others then
    if sqlerrm='wrong provider amount was accepted' then raise; end if;
  end;
  if (select status from public.order_payments where provider_payment_id='pi_one')<>'SUCCEEDED' then
    raise exception 'rejected proof changed the payment';
  end if;
  update public.money_desk_decisions set approver_email='preparer' where approver_email='approver-two';
  begin
    perform public.complete_dev_reviewed_tip_refund_reconciliation(
      '22222222-2222-4222-8222-222222222222',
      '66666666-6666-4666-8666-666666666666',v_proof);
    raise exception 'one independent approver was accepted';
  exception when others then
    if sqlerrm='one independent approver was accepted' then raise; end if;
  end;
  update public.money_desk_decisions set approver_email='approver-two' where approver_email='preparer';

  insert into public.commercial_ledger_transactions
    (payment_id,order_id,transaction_kind,purpose,original_amount,original_currency)
    select payment_id,order_id,transaction_kind,purpose,original_amount,original_currency
    from public.commercial_ledger_transactions
    where transaction_kind='CAPTURE' and purpose='TIP';
  begin
    perform public.complete_dev_reviewed_tip_refund_reconciliation(
      '22222222-2222-4222-8222-222222222222',
      '66666666-6666-4666-8666-666666666666',v_proof);
    raise exception 'ambiguous capture journal was accepted';
  exception when others then
    if sqlerrm='ambiguous capture journal was accepted' then raise; end if;
  end;
  delete from public.commercial_ledger_transactions
    where transaction_kind='CAPTURE' and purpose='TIP'
      and id not in (select transaction_id from public.commercial_ledger_entries);

  v_result := public.complete_dev_reviewed_tip_refund_reconciliation(
    '22222222-2222-4222-8222-222222222222',
    '66666666-6666-4666-8666-666666666666',v_proof);
  if v_result->>'ok'<>'true' or v_result->>'duplicate'<>'false' then
    raise exception 'first recovery did not complete: %',v_result;
  end if;
  if (select status from public.order_tips where id='33333333-3333-4333-8333-333333333333')<>'REFUNDED'
     or (select status from public.order_payments where provider_payment_id='pi_one')<>'REFUNDED'
     or (select refunded_amount from public.order_payments where provider_payment_id='pi_one')<>500
     or (select status from public.tip_money_operation_claims where id='55555555-5555-4555-8555-555555555555')<>'SUCCEEDED'
     or (select money_desk_request_id from public.tip_money_operation_claims where id='55555555-5555-4555-8555-555555555555')<>'22222222-2222-4222-8222-222222222222'
     or (select count(*) from public.order_payment_provider_refunds)<>1
     or (select count(*) from public.commercial_ledger_transactions where transaction_kind='REFUND')<>1
     or (select coalesce(sum(case when direction='DEBIT' then amount else -amount end),0)
         from public.commercial_ledger_entries e join public.commercial_ledger_transactions t on t.id=e.transaction_id
         where t.transaction_kind='REFUND')<>0 then
    raise exception 'recovery state or journal is wrong';
  end if;
  v_result := public.complete_dev_reviewed_tip_refund_reconciliation(
    '22222222-2222-4222-8222-222222222222',
    '66666666-6666-4666-8666-666666666666',v_proof);
  if v_result->>'duplicate'<>'true' or
     (select count(*) from public.order_payment_provider_refunds)<>1 or
     (select count(*) from public.commercial_ledger_transactions where transaction_kind='REFUND')<>1 then
    raise exception 'replay created a second refund record or journal';
  end if;
  raise notice 'PASS: exact refund, two independent approvals, balanced journal and no-op replay';
end $$;
SQL
grep -q 'PASS: exact refund' "$logs/green.log"
echo 'GREEN: exact refund, two independent approvals, balanced journal and no-op replay.'
run_sql <"$repo_root/supabase/migrations/rollback/20261111210000_dev_reviewed_tip_refund_reconciliation.rollback.sql" >"$logs/rollback.log"
if printf "select public.complete_dev_reviewed_tip_refund_reconciliation(null,null,'{}'::jsonb);\n" |
  run_sql >"$logs/rollback-red.log" 2>&1; then
  echo 'Rollback left the recovery function callable.' >&2
  exit 1
fi
grep -q 'does not exist' "$logs/rollback-red.log"
echo 'ROLLBACK: the Dev-only recovery function is removed.'
