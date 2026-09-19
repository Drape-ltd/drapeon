import { renderDrapeonTransactionalEmail } from '../../../../supabase/functions/_shared/email-template'
import { getWelcomeMessage, type WelcomeRole, type WelcomeStep } from '@drape/shared/lifecycle-welcome'
import { buildEmailSmartLink } from '@drape/shared/email-links'

function welcomePreview(role: WelcomeRole, step: WelcomeStep, recipientName: string) {
  const message = getWelcomeMessage(role, step)
  if (!message) throw new Error(`Missing welcome preview for ${role}/${step}`)
  return {
    preheader: message.subject,
    eyebrow: message.eyebrow,
    headline: message.headline,
    recipientName,
    body: message.body,
    ctaLabel: message.ctaLabel,
    ctaUrl: buildEmailSmartLink('https://drapeon.co', message.webPath, 'drape://'),
  }
}

const previewInput = {
  customer: welcomePreview('CUSTOMER', 'WELCOME', 'Anna'),
  'customer-next': welcomePreview('CUSTOMER', 'NEXT_STEP', 'Anna'),
  tailor: welcomePreview('TAILOR', 'WELCOME', 'Alder & Rue'),
  'tailor-next': welcomePreview('TAILOR', 'NEXT_STEP', 'Alder & Rue'),
  payment: {
    preheader: 'Payment received for order #DRP-2048.',
    eyebrow: 'Payment update',
    headline: 'Payment received',
    recipientName: 'Anna',
    body: 'Your payment has been received and the order is now funded in Drapeon.',
    details: [
      { label: 'Order', value: '#DRP-2048' },
      { label: 'Amount', value: '£240.00' },
      { label: 'Status', value: 'Order funded' },
    ],
    ctaLabel: 'Track your order',
    ctaUrl: 'https://drapeon.co/account/orders/DRP-2048',
  },
}

type PreviewKind = keyof typeof previewInput

function isPreviewKind(value: string | null): value is PreviewKind {
  return value === 'customer' || value === 'customer-next' || value === 'tailor' || value === 'tailor-next' || value === 'payment'
}

export function GET(request: Request): Response {
  const url = new URL(request.url)
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Not found', { status: 404 })
  }

  const requestedKind = url.searchParams.get('kind')
  const kind = isPreviewKind(requestedKind) ? requestedKind : 'customer'
  const rendered = renderDrapeonTransactionalEmail(previewInput[kind])
  return new Response(rendered.html, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline';",
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
