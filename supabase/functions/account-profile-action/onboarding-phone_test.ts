import { persistInitialPhone } from './onboarding-phone.ts'

function mock(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = []
  const query: any = {
    from: (...args: unknown[]) => { calls.push(['from', ...args]); return query },
    update: (...args: unknown[]) => { calls.push(['update', ...args]); return query },
    eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return query },
    is: (...args: unknown[]) => { calls.push(['is', ...args]); return query },
    select: (...args: unknown[]) => { calls.push(['select', ...args]); return query },
    maybeSingle: () => Promise.resolve(result),
  }
  return { query, calls }
}

for (const [name, result, expected] of [
  ['confirmed save', { data: { phone: '+2348025550134' }, error: null }, true],
  ['zero rows / concurrent contact change', { data: null, error: null }, false],
  ['database failure', { data: null, error: { message: 'offline' } }, false],
  ['duplicate number', { data: null, error: { code: '23505' } }, false],
  ['mismatched readback', { data: { phone: '+2348025550199' }, error: null }, false],
] as const) {
  Deno.test(`onboarding phone: ${name}`, async () => {
    const { query, calls } = mock(result)
    const saved = await persistInitialPhone(query, 'caller-id', null, '+2348025550134')
    if (saved !== expected) throw new Error(`Unexpected save result: ${saved}`)
    if (!calls.some(call => JSON.stringify(call) === '["eq","id","caller-id"]')) throw new Error('Missing caller scope')
    if (!calls.some(call => JSON.stringify(call) === '["is","phone",null]')) throw new Error('Missing compare-and-set')
  })
}

Deno.test('onboarding phone: legacy empty string compare-and-set', async () => {
  const { query, calls } = mock({ data: { phone: '+2348025550134' }, error: null })
  await persistInitialPhone(query, 'caller-id', '', '+2348025550134')
  if (!calls.some(call => JSON.stringify(call) === '["eq","phone",""]')) throw new Error('Missing empty-string guard')
})

Deno.test('onboarding phone: existing number cannot be replaced', async () => {
  const { query, calls } = mock({ data: { phone: '+2348025550134' }, error: null })
  if (await persistInitialPhone(query, 'caller-id', '+2348025550199', '+2348025550134')) {
    throw new Error('Existing contact was replaced')
  }
  if (calls.length) throw new Error('Existing contact attempted a write')
})

Deno.test('onboarding phone: OTP bypass does not claim ownership verification', async () => {
  const { query, calls } = mock({ data: { phone: '+2348025550134' }, error: null })
  await persistInitialPhone(query, 'caller-id', null, '+2348025550134')
  const update = calls.find(call => call[0] === 'update')?.[1] as { phone_verified_at?: unknown }
  if (update?.phone_verified_at !== null) throw new Error('Bypass claimed phone ownership')
})

Deno.test('onboarding phone: verified timestamp is persisted with contact', async () => {
  const { query, calls } = mock({ data: { phone: '+2348025550134' }, error: null })
  const verifiedAt = '2026-09-28T12:00:00.000Z'
  await persistInitialPhone(query, 'caller-id', null, '+2348025550134', verifiedAt)
  const update = calls.find(call => call[0] === 'update')?.[1] as { phone_verified_at?: unknown }
  if (update?.phone_verified_at !== verifiedAt) throw new Error('Verification timestamp was dropped')
})
