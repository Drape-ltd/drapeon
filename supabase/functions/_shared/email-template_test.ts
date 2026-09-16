import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { normalizeDrapeonSender, renderDrapeonTransactionalEmail } from './email-template.ts'

Deno.test('normalizes stale sender display names to Drapeon', () => {
  assertEquals(
    normalizeDrapeonSender('Drapeon <noreply@drapeon.co>'),
    'Drapeon <noreply@drapeon.co>'
  )
})

Deno.test('uses the canonical Drapeon email-safe palette', () => {
  const email = renderDrapeonTransactionalEmail({
    preheader: 'Welcome to Drapeon.',
    headline: 'Your Drapeon account is ready',
    recipientName: 'there',
    body: 'Your account is ready for the next step.',
    details: [{ label: 'Role', value: 'Customer' }],
    ctaLabel: 'Open Drapeon',
    ctaUrl: 'https://drapeon.co',
  })

  for (const token of [
    '#F9F7F3',
    '#F1EFE8',
    '#E0DDD8',
    '#2D6A4F',
    '#245540',
    '#2C2C2A',
    '#5C5B58',
  ]) {
    assertStringIncludes(email.html, token)
  }
  for (const staleToken of ['#f4f1eb', '#f5f3ee', '#2f7557', '#17211c']) {
    if (email.html.includes(staleToken)) throw new Error(`Stale email token remains: ${staleToken}`)
  }
})

Deno.test('keeps one high-contrast source palette for Gmail mobile dark mode', () => {
  const email = renderDrapeonTransactionalEmail({
    preheader: 'Payment received',
    headline: 'Payment received',
    recipientName: 'there',
    body: 'Your order is funded.',
    details: [{ label: 'Order', value: '#DRP-2048' }],
    ctaLabel: 'Track your order',
    ctaUrl: 'https://drapeon.co/account/orders/order-1',
  })

  if (email.html.includes('prefers-color-scheme') || email.html.includes('color-scheme')) {
    throw new Error('Transactional emails must not declare a dark palette that Gmail mobile can partially invert.')
  }
  for (const marker of [
    'class="drapeon-email-detail-label"',
    'class="drapeon-email-detail-value"',
    'background:#FFFFFF',
    'color:#2C2C2A',
    'color:#5C5B58',
  ]) {
    assertStringIncludes(email.html, marker)
  }
})

Deno.test('keeps responsive and Outlook-safe table fallbacks in the HTML shell', () => {
  const email = renderDrapeonTransactionalEmail({
    preheader: 'Order update',
    headline: 'Your order is moving',
    recipientName: 'Anna',
    body: 'The tailor has started work.',
    ctaLabel: 'View order',
    ctaUrl: 'https://drapeon.co/account/orders/order-1',
  })

  for (const marker of [
    'mso-table-lspace:0pt',
    'mso-table-rspace:0pt',
    '-ms-interpolation-mode:bicubic',
    '.drapeon-email-gutter',
    '@media screen and (max-width:600px)',
    'bgcolor="#FFFFFF"',
  ]) {
    assertStringIncludes(email.html, marker)
  }
  if (email.html.includes('.drapeon-email-greeting { font-size:30px')) {
    throw new Error('Mobile title rule must not resize the greeting copy.')
  }
})

Deno.test('keeps Supabase auth templates on the Gmail-safe shared palette', async () => {
  for (const templateName of ['recovery.html', 'email_changed_notification.html', 'password_changed_notification.html']) {
    const html = await Deno.readTextFile(new URL(`../../templates/${templateName}`, import.meta.url))
    for (const marker of [
      'drapeon-auth-email-card',
      'drapeon-auth-email-muted',
      "Georgia,'Times New Roman',serif",
    ]) {
      assertStringIncludes(html, marker)
    }
    for (const staleToken of ['#f4f1eb', '#f5f3ee', '#2f7557', '#17211c']) {
      if (html.toLowerCase().includes(staleToken)) throw new Error(`${templateName} still contains ${staleToken}`)
    }
    if (html.includes('prefers-color-scheme') || html.includes('color-scheme')) {
      throw new Error(`${templateName} declares a Gmail-unsafe dark-mode palette`)
    }
  }
})

Deno.test('supports specialized Drapeon sender identities', () => {
  assertEquals(
    normalizeDrapeonSender(
      'Drapeon <noreply@drapeon.co>',
      'Drapeon Security',
      'security@drapeon.co'
    ),
    'Drapeon Security <noreply@drapeon.co>'
  )
  assertEquals(
    normalizeDrapeonSender('noreply@drapeon.co', 'Drapeon Orders'),
    'Drapeon Orders <noreply@drapeon.co>',
  )
})

Deno.test('escapes user content and provides a plain-text fallback', () => {
  const email = renderDrapeonTransactionalEmail({
    preheader: 'Quote accepted',
    headline: 'Quote <accepted>',
    recipientName: '<Anna>',
    body: 'A customer accepted your quote.',
    details: [
      { label: 'Order', value: '#DRP<&>' },
      { label: 'Item', value: 'Agbada' },
    ],
    ctaLabel: 'Open order',
    ctaUrl: 'https://drapeon.co/account/orders/order-1',
  })

  assertStringIncludes(email.html, 'Quote &lt;accepted&gt;')
  assertStringIncludes(email.html, 'Hi &lt;Anna&gt;,')
  assertStringIncludes(email.html, '#DRP&lt;&amp;&gt;')
  assertStringIncludes(email.text, 'Open order: https://drapeon.co/account/orders/order-1')
})

Deno.test('renders secure media and app-open fallbacks without publicizing storage paths', () => {
  const email = renderDrapeonTransactionalEmail({
    preheader: 'New production proof',
    headline: 'Review the latest order media',
    recipientName: 'Anna',
    body: 'A new image is ready.',
    ctaLabel: 'View securely on web',
    ctaUrl: 'https://drapeon.co/account/orders/order-1',
    secondaryCtaLabel: 'Open in Drapeon',
    secondaryCtaUrl: 'drapeon://orders/order-1',
    evidenceImageUrl: 'https://signed.example/media.jpg?token=short-lived',
    evidenceLinkUrl: 'https://drapeon.co/account/orders/order-1#order-media',
  })

  assertStringIncludes(email.html, 'View this media securely on Drapeon')
  assertStringIncludes(email.html, 'class="drapeon-email-media"')
  assertStringIncludes(email.html, 'class="drapeon-email-link"')
  assertStringIncludes(email.html, 'https://drapeon.co/account/orders/order-1#order-media')
  assertStringIncludes(email.html, 'Open in Drapeon')
  assertStringIncludes(email.text, 'Open in Drapeon: drapeon://orders/order-1')
})
