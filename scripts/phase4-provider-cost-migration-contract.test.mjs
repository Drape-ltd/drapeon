import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const migrationDir = new URL('../supabase/migrations/', import.meta.url)

function latestDefinition(signature) {
  const name = readdirSync(migrationDir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .filter((entry) => readFileSync(new URL(entry, migrationDir), 'utf8').includes(signature))
    .at(-1)
  assert.ok(name, `a migration must define ${signature}`)
  return readFileSync(new URL(name, migrationDir), 'utf8')
}

const quoteMigration = latestDefinition(
  'create or replace function public.accept_active_order_quote_with_route_snapshot_v2(',
)
const readyMadeMigration = latestDefinition(
  'create or replace function public.snapshot_ready_made_payment_route_v2(',
)

test('quote acceptance keeps the tailor quote immutable and locks customer cost before snapshot', () => {
  assert.equal(
    /update\s+public\.order_quotes/i.test(quoteMigration),
    false,
    'the provider-cost wrapper must never rewrite the accepted tailor quote',
  )
  assert.match(quoteMigration, /if v_quote\.platform_fee_amount <> 0 then/i)
  assert.match(quoteMigration, /v_provider_cost := floor\(\(\(v_quote\.total_amount::numeric \* 200\) \+ 5000\) \/ 10000\)::integer/i)

  const lock = quoteMigration.indexOf('update public.orders')
  const snapshot = quoteMigration.indexOf('v_result := public.accept_active_order_quote_with_route_snapshot(')
  assert.ok(lock >= 0 && snapshot > lock, 'customer amounts must lock before the immutable route snapshot')
  assert.match(quoteMigration, /set platform_fee_amount = v_provider_cost,\s+total_amount = v_customer_total,\s+quoted_amount = v_customer_total/i)
})

test('ready-made acceptance locks customer cost before its route snapshot', () => {
  const functionStart = readyMadeMigration.indexOf('create or replace function public.snapshot_ready_made_payment_route_v2(')
  assert.ok(functionStart >= 0, 'ready-made v2 route wrapper must exist')
  const sql = readyMadeMigration.slice(functionStart)
  const lock = sql.indexOf('update public.orders')
  const snapshot = sql.indexOf('v_result := public.snapshot_ready_made_payment_route(')
  assert.ok(lock >= 0 && snapshot > lock, 'ready-made customer amounts must lock before snapshot')
  assert.match(sql, /v_provider_cost := floor\(\(\(v_order\.total_amount::numeric \* 200\) \+ 5000\) \/ 10000\)::integer/i)
})
