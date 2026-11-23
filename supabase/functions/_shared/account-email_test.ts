import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { accountEmailProviderHeaders, isMissingAccountEmailUser, sendAccountEventEmail, suppressDevBachsQaEmail } from './account-email.ts'

const existingUser = { auth: { admin: { getUserById: async () => ({ data: { user: { email: 'preview@example.com' } }, error: null }) } } } as never
const softDeletedUser = { auth: { admin: { getUserById: async () => ({
  data: { user: { email: 'soft-deleted@example.test', deleted_at: '2026-11-19T17:16:22.70184Z' } },
  error: null,
}) } } } as never

Deno.test('suppresses only tagged Bachs QA mail in Dev', () => {
  const qa = 'phase3-bachs-qa-3052d54e-6cdb-4c5a-991c-5499ff2c7fc8@example.com'
  assertEquals(suppressDevBachsQaEmail(qa, 'https://pqptfuqogvrajozfsqzi.supabase.co'), true)
  assertEquals(suppressDevBachsQaEmail(qa, 'https://wkfsrunetmgjdtcurmoj.supabase.co'), false)
  assertEquals(suppressDevBachsQaEmail('customer@example.com', 'https://pqptfuqogvrajozfsqzi.supabase.co'), false)
  assertEquals(suppressDevBachsQaEmail(qa, 'https://pqptfuqogvrajozfsqzi.supabase.co.evil.test'), false)
})

Deno.test('tagged Dev QA email is skipped before contacting Resend', async () => {
  const previous = Deno.env.get('SUPABASE_URL')
  Deno.env.set('SUPABASE_URL', 'https://pqptfuqogvrajozfsqzi.supabase.co')
  try {
    const result = await sendAccountEventEmail(existingUser, {
      userId: 'qa-user', recipientEmail: 'phase3-bachs-qa-3052d54e-6cdb-4c5a-991c-5499ff2c7fc8@example.com',
      subject: 'QA', headline: 'QA', body: 'QA', ctaLabel: 'QA', webPath: '/',
    })
    assertEquals(result, { status: 'SKIPPED', reason: 'DEV_QA_SUPPRESSED' })
  } finally {
    if (previous === undefined) Deno.env.delete('SUPABASE_URL')
    else Deno.env.set('SUPABASE_URL', previous)
  }
})

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
    const result = await sendAccountEventEmail(existingUser, {
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

Deno.test('missing account user skips queued mail even with an explicit address', async () => {
  const missingUser = { auth: { admin: { getUserById: async () => ({
    data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' },
  }) } } } as never
  const previousFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Deleted user must not reach Resend') }
  try {
    assertEquals(await sendAccountEventEmail(missingUser, {
      userId: 'deleted-user', recipientEmail: 'old@example.com', subject: 'Old', headline: 'Old',
      body: 'Old', ctaLabel: 'Open', webPath: '/',
    }), { status: 'SKIPPED', reason: 'MISSING_USER' })
  } finally {
    globalThis.fetch = previousFetch
  }
})

Deno.test('soft-deleted account user skips ordinary queued mail with MISSING_USER', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Soft-deleted user must not reach Resend') }
  try {
    assertEquals(await sendAccountEventEmail(softDeletedUser, {
      userId: 'soft-deleted-user', recipientEmail: 'saved@example.test',
      subject: 'Account update', headline: 'Account update', body: 'Account update',
      ctaLabel: 'Open', webPath: '/',
    }), { status: 'SKIPPED', reason: 'MISSING_USER' })
  } finally {
    globalThis.fetch = previousFetch
  }
})

Deno.test('account deletion completion mail uses its explicit recipient after Auth soft-delete', async () => {
  const previousFetch = globalThis.fetch
  const previousApiKey = Deno.env.get('RESEND_API_KEY')
  const previousFrom = Deno.env.get('RESEND_FROM')
  const sent: { to?: string[]; subject?: string } = {}
  Deno.env.set('RESEND_API_KEY', 'test-resend-key')
  Deno.env.set('RESEND_FROM', 'Drapeon <noreply@drapeon.co>')
  globalThis.fetch = async (_input, init) => {
    const request = new Request('https://api.resend.com/emails', init)
    const body = await request.json() as { to?: string[]; subject?: string }
    sent.to = body.to
    sent.subject = body.subject
    return new Response(JSON.stringify({ id: 'email_deletion_complete_1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const result = await sendAccountEventEmail(softDeletedUser, {
      userId: 'deleted-user', recipientEmail: 'deleted-owner@example.test',
      allowMissingUserRecipient: true,
      subject: 'Your Drapeon account deletion is complete', headline: 'Your account has been deleted',
      body: 'Your sign-in access and public profile have been removed.',
      ctaLabel: 'Privacy information', webPath: '/privacy',
    })

    assertEquals(result, { status: 'ACCEPTED', provider: 'RESEND', providerReference: 'email_deletion_complete_1' })
    assertEquals(sent.to, ['deleted-owner@example.test'])
    assertEquals(sent.subject, 'Your Drapeon account deletion is complete')
  } finally {
    globalThis.fetch = previousFetch
    if (previousApiKey === undefined) Deno.env.delete('RESEND_API_KEY')
    else Deno.env.set('RESEND_API_KEY', previousApiKey)
    if (previousFrom === undefined) Deno.env.delete('RESEND_FROM')
    else Deno.env.set('RESEND_FROM', previousFrom)
  }
})

Deno.test('temporary auth lookup failures remain retryable', () => {
  assertEquals(isMissingAccountEmailUser({ status: 503, code: 'service_unavailable', message: 'Unavailable' }, null), false)
  assertEquals(isMissingAccountEmailUser({ status: 404, code: 'user_not_found', message: 'User not found' }, null), true)
})

Deno.test('temporary Auth lookup failure throws so the queue can retry', async () => {
  const unavailableUser = { auth: { admin: { getUserById: async () => ({
    data: { user: null }, error: { status: 503, code: 'service_unavailable', message: 'Unavailable' },
  }) } } } as never

  await assertRejects(
    () => sendAccountEventEmail(unavailableUser, {
      userId: 'temporarily-unavailable-user', recipientEmail: 'saved@example.test',
      subject: 'Account update', headline: 'Account update', body: 'Account update',
      ctaLabel: 'Open', webPath: '/',
    }),
    Error,
    'Account email lookup failed: Unavailable',
  )
})
