#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-order-photo-forward-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
diagnose() { docker logs "$container" 2>&1 | tail -40 || true; }
trap cleanup EXIT
trap diagnose ERR
docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
for file in \
  supabase/tests/order_photo_prod_forward_fixture.sql \
  supabase/migrations/20261124190000_prod_forward_order_photo_party_read.sql \
  supabase/migrations/20261124190100_prod_forward_order_photo_evidence_prefixes.sql \
  supabase/migrations/20261124190200_prod_forward_make_order_photos_private.sql \
  supabase/tests/order_photo_prod_forward_behavior.sql; do
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < "$repo_root/$file" >/dev/null
done
echo 'PASS: Production-shaped UUID policy and private-bucket rehearsal.'
