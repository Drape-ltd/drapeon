import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260928220000_align_customer_fabric_source_enum.sql');
assert.match(migration, /RENAME VALUE\s+'CUSTOMER_SUPPLIED'\s+TO\s+'CUSTOMER_SUPPLIES'/i);
assert.match(migration, /raise exception/i, 'Ambiguous enum states must fail closed');

const descriptionCompat = read('supabase/migrations/20260928230000_order_description_insert_compat.sql');
assert.match(descriptionCompat, /ADD COLUMN IF NOT EXISTS description text/i);
assert.match(descriptionCompat, /NEW\.description\s*:=\s*NEW\.garment_description/);
assert.match(descriptionCompat, /NEW\.garment_description\s*:=\s*NEW\.description/);
assert.match(descriptionCompat, /BEFORE INSERT ON public\.orders/i);
assert.doesNotMatch(descriptionCompat, /SECURITY DEFINER|DISABLE ROW LEVEL SECURITY|DROP NOT NULL|UPDATE public\.orders/i,
  'Insert compatibility must not widen authorization, relax production constraints or backfill existing orders');

const workspace = read('apps/web/features/account/orders/order-detail-workspace.tsx');
const select = workspace.match(/const orderSelect\s*=\s*'([^']+)'/s)?.[1];
assert.ok(select, 'Order select must be inspectable');
assert.ok(!select.split(',').map((column) => column.trim()).includes('id_text'),
  'Portable order reads must not require the legacy id_text alias');
assert.match(workspace, /\.eq\('subject_id', order\.id\)/,
  'Completed-order surveys must still use the canonical order ID');
assert.doesNotMatch(workspace, /order\.id_text/);

for (const path of [
  'apps/mobile/app/(customer)/brief/[tailorId].tsx',
  'apps/web/features/account/brief/brief-form.tsx',
  'supabase/functions/custom-order-action/index.ts',
]) {
  assert.match(read(path), /CUSTOMER_SUPPLIES/, `${fileURLToPath(new URL(path, root))}: canonical fabric choice required`);
}
console.log('Brief submission contract check passed: canonical fabric enum, insert-description compatibility, portable order ID, preserved survey context.');
