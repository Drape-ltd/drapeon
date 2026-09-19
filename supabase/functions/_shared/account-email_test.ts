import { assertEquals, assertStringIncludes, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { accountEmailProviderHeaders, sendAccountEventEmail } from './account-email.ts'

Deno.test('keeps valid lifecycle template identity in provider headers', () => {
  assertEquals(accountEmailProviderHeaders('WELCOME_CUSTOMER_V1'), {
    'X-Drapeon-Template-Key': 'WELCOME_CUSTOMER_V1',
  })
})

Deno.test('omits provider template identity when no template is supplied', () => {
  assertEquals(accountEmailProviderHeaders(null), {})
})

Deno.test('rejects unsafe lifecycle template identity', () => {
  assertThrows(
    () => accountEmailProviderHeaders('welcome/customer'),
    Error,
    'templateKey is invalid',
  )
})

Deno.test('keeps welcome provider correlation and idempotency together', async () => {
  const previousApiKey = Deno.env.get('RESEND_API_KEY')
  const previousFrom = Deno.env.get('RESEND_FROM')
  const previousSiteUrl = Deno.env.get('SITE_URL')
  const previousFetch = globalThis.fetch
  const capture: { headers?: Headers; body?: Record<string, unknown> } = {}

  Deno.env.set('RESEND_API_KEY', 'test-resend-key')
  Deno.env.set('RESEND_FROM', 'Drapeon <noreply@drapeon.co>')
  Deno.env.set('SITE_URL', 'https://drapeon.co')
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    capture.headers = request.headers
    capture.body = await request.json() as Record<string, unknown>
    return new Response(JSON.stringify({ id: 'email_test_1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const result = await sendAccountEventEmail({} as never, {
      userId: 'user-1',
      recipientEmail: 'preview@example.com',
      recipientName: '  Anna   Example  ',
      templateKey: 'WELCOME_CUSTOMER_V1',
      subject: 'Welcome to Drapeon',
      headline: 'Find work worth wearing.',
      body: 'Discover trusted tailors.',
      ctaLabel: 'Explore Drapeon',
      webPath: '/explore',
      appUrl: 'drape://',
      idempotencyKey: 'welcome:customer:user-1:welcome:SEND_ACCOUNT_EVENT_EMAIL',
    })

    assertEquals(result.status, 'ACCEPTED')
    assertEquals(result.providerReference, 'email_test_1')
    assertEquals(capture.headers?.get('Idempotency-Key'), 'welcome:customer:user-1:welcome:SEND_ACCOUNT_EVENT_EMAIL')
    assertEquals(capture.body?.headers, { 'X-Drapeon-Template-Key': 'WELCOME_CUSTOMER_V1' })
    assertStringIncludes(String(capture.body?.html), 'Hi Anna Example,')
    assertStringIncludes(String(capture.body?.html), 'https://drapeon.co/open?next=%2Fexplore&amp;app=drape%3A%2F%2F')
  } finally {
    globalThis.fetch = previousFetch
    if (previousApiKey === undefined) Deno.env.delete('RESEND_API_KEY')
    else Deno.env.set('RESEND_API_KEY', previousApiKey)
    if (previousFrom === undefined) Deno.env.delete('RESEND_FROM')
    else Deno.env.set('RESEND_FROM', previousFrom)
    if (previousSiteUrl === undefined) Deno.env.delete('SITE_URL')
    else Deno.env.set('SITE_URL', previousSiteUrl)
  }
})
