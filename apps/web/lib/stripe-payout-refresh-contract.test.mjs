import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routeUrl = new URL('../app/ops/action/route.ts', import.meta.url)
const edgeUrl = new URL('../../../supabase/functions/payout-account-action/index.ts', import.meta.url)

test('Ops Stripe destination refresh sends the header required by the Edge action', async () => {
  const [routeSource, edgeSource] = await Promise.all([
    readFile(routeUrl, 'utf8'),
    readFile(edgeUrl, 'utf8'),
  ])

  assert.match(
    routeSource,
    /'X-Drape-Service-Key': serviceRoleKey/u,
    'the Ops route must send the service key in the dedicated header'
  )
  assert.match(
    edgeSource,
    /req\.headers\.get\('x-drape-service-key'\)/u,
    'the Edge action must read the same case-insensitive header'
  )
  assert.match(
    edgeSource,
    /Service authorization is required\.' \}, 403/u,
    'a missing or invalid service header must remain a 403'
  )
})

test('Stripe refresh is required only for clearance, not fail-safe blocking', async () => {
  const routeSource = await readFile(routeUrl, 'utf8')
  assert.match(
    routeSource,
    /destination\.provider === 'STRIPE' && outcome === 'CLEARED'/u
  )
})
