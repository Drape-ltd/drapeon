#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-unstarted-tranche-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'create role anon; create role authenticated; create role service_role;' >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$repo_root/supabase/tests/tranche_partial_refund_isolated_schema.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
ALTER TABLE public.payout_claims ADD PRIMARY KEY (id);
ALTER TABLE public.money_desk_requests ADD PRIMARY KEY (id);
ALTER TABLE public.payout_provider_operations ADD PRIMARY KEY (id);
ALTER TABLE public.payouts ADD PRIMARY KEY (id);
ALTER TABLE public.order_settlement_tranches ADD PRIMARY KEY (id);
ALTER TABLE public.order_payments ADD PRIMARY KEY (id);
ALTER TABLE public.orders ADD PRIMARY KEY (id);
ALTER TABLE public.payout_provider_operations ADD COLUMN reviewed_retry_id uuid;
ALTER TABLE public.payout_provider_operations ADD CONSTRAINT payout_provider_operations_check
  CHECK ((operation_number=1 AND reviewed_correction_id IS NULL AND reviewed_retry_id IS NULL AND money_desk_request_id IS NULL)
    OR (operation_number>1 AND money_desk_request_id IS NOT NULL
      AND ((reviewed_correction_id IS NOT NULL AND reviewed_retry_id IS NULL)
        OR (reviewed_correction_id IS NULL AND reviewed_retry_id IS NOT NULL))));
CREATE TABLE public.payout_attempts (
  id uuid primary key, claim_id uuid not null, attempt_number integer not null,
  status text not null, provider_evidence jsonb not null default '{}'::jsonb
);
SQL
if [[ "${CLOSE_UNSTARTED_MIGRATION:-$repo_root/supabase/migrations/20261110150000_close_unstarted_tranche_payouts.sql}" != "SKIP" ]]; then
  migration="${CLOSE_UNSTARTED_MIGRATION:-$repo_root/supabase/migrations/20261110150000_close_unstarted_tranche_payouts.sql}"
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >/dev/null
fi
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/close_unstarted_settlement_tranche_payout.sql"
if [[ "${CLOSE_UNSTARTED_MIGRATION:-$repo_root/supabase/migrations/20261110150000_close_unstarted_tranche_payouts.sql}" != "SKIP" ]]; then
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
    <"$repo_root/supabase/migrations/rollback/20261110150000_close_unstarted_tranche_payouts.rollback.sql" >/dev/null
  docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -tAc \
    "SELECT to_regprocedure('public.close_unstarted_settlement_tranche_payout(uuid,text)') IS NULL" \
    | grep -qx t
fi
