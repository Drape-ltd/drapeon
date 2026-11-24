import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261124211043_rls_performance_batch2.sql', import.meta.url),
  'utf8',
)

const targetTables = [
  'conversation_translation_preferences',
  'customer_reviews',
  'reviews',
  'tailor_pickup_details',
  'web_push_subscriptions',
]

test('batch 2 stays within its five-table, nineteen-initplan-policy scope', () => {
  const created = [...sql.matchAll(/create policy "[^"]+"[^]*?on public[.]([a-z_]+)/gu)]
    .map((match) => match[1])
  assert.deepEqual([...new Set(created)].sort(), targetTables)
  assert.equal(created.length, 16)

  const compatibilityDrops = [
    'public: read published reviews',
    'parties: read own order review',
  ]
  const drops = [...sql.matchAll(/drop policy if exists "([^"]+)" on public[.]([a-z_]+);/gu)]
  assert.equal(
    drops.filter((match) => !compatibilityDrops.includes(match[1])).length,
    20,
  )
})

test('every direct auth uid call is an initplan expression', () => {
  assert.doesNotMatch(
    sql.replaceAll('(select auth.uid())', ''),
    /auth[.]uid[ ]*[(]/u,
  )
})

test('same-action read policies preserve every Production access branch', () => {
  assert.match(
    sql,
    /Published or order-party reviews are readable[^]*published_at is not null and flagged = false[^]*or exists[^]*customer_id::text = [(]select auth[.]uid[(][)][)]::text[^]*or [(][^]*tailor_id::text = [(]select auth[.]uid[(][)][)]::text/u,
  )
  assert.match(
    sql,
    /Customers and relevant tailors read customer reviews[^]*auth[.]uid[(][)][)] = customer_id[^]*or [(]select auth[.]uid[(][)][)] = tailor_id[^]*or exists/u,
  )
  assert.match(
    sql,
    /owner or unlocked customer reads[^]*user_id::text = [(]select auth[.]uid[(][)][)]::text[^]*or exists[^]*LOCAL_COLLECTION/u,
  )
})

test('write policies retain ownership checks on both visibility and new rows', () => {
  assert.match(
    sql,
    /tailors: update own review response[^]*using [(][^]*tp[.]user_id::text = [(]select auth[.]uid[(][)][)]::text[^]*with check [(][^]*tp[.]user_id::text = [(]select auth[.]uid[(][)][)]::text/u,
  )
  assert.match(
    sql,
    /users: update own account web push subscriptions[^]*using [(]audience = 'ACCOUNT' and user_id = [(]select auth[.]uid[(][)][)][)][^]*with check [(]audience = 'ACCOUNT' and user_id = [(]select auth[.]uid[(][)][)][)]/u,
  )
  assert.match(
    sql,
    /translation preferences: participant updates own[^]*using [(][(]select auth[.]uid[(][)][)] = user_id[)][^]*with check [(][(]select auth[.]uid[(][)][)] = user_id[)]/u,
  )
})
