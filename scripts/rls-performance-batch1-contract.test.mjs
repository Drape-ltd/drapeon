import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261124171708_rls_performance_batch1.sql', import.meta.url), 'utf8')

const dropped = [...sql.matchAll(/drop policy if exists "([^"]+)" on public\.(orders|messages|tailor_profiles|customer_profiles);/gu)]
  .map((match) => `${match[2]}:${match[1]}`)
const created = [...sql.matchAll(/create policy "([^"]+)" on public\.(orders|messages|tailor_profiles|customer_profiles)/gu)]
  .map((match) => `${match[2]}:${match[1]}`)

test('batch replaces all 18 Production policies across the four approved tables', () => {
  const devCompatibilityPolicies = new Set([
    'orders:customers: create orders',
    'orders:customers: read own orders',
    'orders:tailors: read assigned orders',
    'orders:customers: update own orders',
    'orders:tailors: update assigned orders',
    'messages:parties: read messages for own orders',
    'tailor_profiles:Live tailor profiles are readable by authenticated users',
    'tailor_profiles:Tailors can read their own profile',
    'tailor_profiles:customers: read tailor profile for shared orders',
    'tailor_profiles:public: read live tailor profiles',
    'tailor_profiles:tailors: read own profile',
    'customer_profiles:customers: insert own profile',
    'customer_profiles:customers: read own profile',
    'customer_profiles:tailors: read customer profile for shared orders',
    'customer_profiles:customers: update own profile',
  ])
  assert.equal(dropped.filter((policy) => !devCompatibilityPolicies.has(policy)).length, 18)
  assert.deepEqual([...new Set(dropped)].sort(), dropped.slice().sort())
  assert.deepEqual([...new Set(created)].length, 14)
  assert.doesNotMatch(sql, /public\.(?!orders|messages|tailor_profiles|customer_profiles|is_terminal_order_stage|order_stage|seller_items)[a-z_]+\s+(?:for|on)/iu)
})

test('every direct auth helper is initialized once per query', () => {
  const withoutWrappedCalls = sql
    .replaceAll('(select auth.uid())', '')
  assert.doesNotMatch(withoutWrappedCalls, /auth\.uid\s*\(/u)
})

test('consolidated policies retain both sides of each existing access OR', () => {
  assert.match(sql, /customer_id::text = \(select auth\.uid\(\)\)::text[\s\S]*or[\s\S]*tailor_id::text = \(select auth\.uid\(\)\)::text/u)
  assert.match(sql, /Public or owner reads tailor profiles[\s\S]*is_live = true[\s\S]*or user_id::text = \(select auth\.uid\(\)\)::text/u)
  assert.match(sql, /Customer or active-order tailor reads customer profile[\s\S]*user_id[\s\S]*or exists/u)
  assert.match(sql, /Order parties send messages[\s\S]*\)\n  or\n  \(/u)
})

