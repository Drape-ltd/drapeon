#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_root/supabase/migrations/20261126173651_phase4_s3_uuid_safe_forward_repair.sql"
guards="$repo_root/supabase/migrations/20261126174309_phase4_s3_merged_money_guards.sql"
container="drape-phase4-s3-uuid-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
ready=0
for _ in $(seq 1 40); do
  if docker logs "$container" 2>&1 | grep -F 'PostgreSQL init process complete; ready for start up.' >/dev/null \
    && docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  docker logs "$container" >&2
  exit 1
fi

docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  -c 'create role anon; create role authenticated; create role service_role;' >/dev/null
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/phase4_s3_uuid_production_shape.sql" >/dev/null
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  <"$migration" >/dev/null
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  <"$migration" >/dev/null
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  <"$migration" >/dev/null
docker exec "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  -c "insert into supabase_migrations.schema_migrations values ('20261126173651')" >/dev/null
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  <"$guards" >/dev/null
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  <"$guards" >/dev/null
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/phase4_s3_uuid_runtime.sql" >/dev/null
echo 'Phase 4 S3 UUID-safe forward apply, reapply, and eleven-function runtime checks passed.'
