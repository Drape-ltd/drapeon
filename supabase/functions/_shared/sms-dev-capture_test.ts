import { getSmsProvider, hasSmsConfig, isDevCaptureProject, sendSmsDirect, sendSmsToUser } from './sms.ts'

const dev = 'https://pqptfuqogvrajozfsqzi.supabase.co'

Deno.test('dev capture accepts only the exact Development host', () => {
  for (const [url, expected] of [
    [dev, true],
    ['https://wkfsrunetmgjdtcurmoj.supabase.co', false],
    ['https://pqptfuqogvrajozfsqzi.supabase.co.evil.com', false],
    ['http://kong:8000', false],
    ['not a URL', false],
    [undefined, false],
  ] as const) {
    if (isDevCaptureProject(url) !== expected) throw new Error(`Wrong host decision for ${url}`)
  }
})

Deno.test('dev capture on Production fails closed without throwing from selector or notifications', async () => {
  const originalProvider = Deno.env.get('SMS_PROVIDER')
  const originalUrl = Deno.env.get('SUPABASE_URL')
  try {
    Deno.env.set('SMS_PROVIDER', 'dev_capture')
    Deno.env.set('SUPABASE_URL', 'https://wkfsrunetmgjdtcurmoj.supabase.co')
    if (getSmsProvider() !== 'DEV_CAPTURE') throw new Error('Provider selection changed')
    if (hasSmsConfig()) throw new Error('Production accepted capture provider')
    const supabase = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) }
    const result = await sendSmsToUser({ supabase: supabase as never, userId: 'test', audience: 'CUSTOMER', event: 'test', body: 'test' })
    if (result.status !== 'SKIPPED') throw new Error('Notification did not skip')
    let threw = false
    try { await sendSmsDirect('+12025550100', 'test') } catch { threw = true }
    if (!threw) throw new Error('Direct send did not fail closed')
  } finally {
    if (originalProvider === undefined) Deno.env.delete('SMS_PROVIDER'); else Deno.env.set('SMS_PROVIDER', originalProvider)
    if (originalUrl === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', originalUrl)
  }
})
