'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'

const PAYMENT_RETURN_KEY = 'drapeon:payment-return'
const ORDER_RETURN_LOOKUP_TIMEOUT_MS = 4_000

type PaymentReturn = { orderId: string; returnTo: Route }

function buildAppUrl(reference: string | null, checkoutId: string | null, status: string | null) {
  const params = new URLSearchParams()
  if (reference) {
    params.set('reference', reference)
    params.set('trxref', reference)
  }
  if (checkoutId) params.set('checkout_id', checkoutId)
  if (status) params.set('status', status)
  const query = params.toString()
  return `drape:///payment-redirect${query ? `?${query}` : ''}`
}

function readStoredReturn(): PaymentReturn | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(PAYMENT_RETURN_KEY) ?? '') as Partial<PaymentReturn>
    if (!value.orderId || value.returnTo !== `/account/orders/${value.orderId}`) return null
    return { orderId: value.orderId, returnTo: value.returnTo as Route }
  } catch {
    return null
  }
}

export default function PaystackCallbackPage(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') ?? searchParams.get('trxref')
  const rawCheckoutId = searchParams.get('checkout_id')
  const checkoutId = rawCheckoutId && /^chk_[A-Za-z0-9_-]{1,196}$/u.test(rawCheckoutId)
    ? rawCheckoutId
    : null
  const status = searchParams.get('status')
  const appUrl = useMemo(() => buildAppUrl(reference, checkoutId, status), [checkoutId, reference, status])
  const [accountReturn, setAccountReturn] = useState<PaymentReturn | null>(null)
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function resolveReturn() {
      let resolved = readStoredReturn()

      const providerReference = reference && /^[A-Za-z0-9_-]{1,200}$/u.test(reference)
        ? reference
        : checkoutId
      if (!resolved && providerReference) {
        let lookupTimeout: ReturnType<typeof setTimeout> | undefined
        try {
          const supabase = createClient()
          const lookup = (async (): Promise<PaymentReturn | null> => {
            const { data: auth } = await supabase.auth.getUser()
            if (!auth.user) return null
            const { data: order } = await supabase
              .from('orders')
              .select('id')
              .eq('customer_id', auth.user.id)
              .or(`payment_intent_id.eq.${providerReference},fulfillment_payment_intent_id.eq.${providerReference}`)
              .maybeSingle()
            return order?.id
              ? { orderId: order.id, returnTo: `/account/orders/${order.id}` as Route }
              : null
          })()
          resolved = await Promise.race([
            lookup,
            new Promise<null>((resolve) => {
              lookupTimeout = setTimeout(() => resolve(null), ORDER_RETURN_LOOKUP_TIMEOUT_MS)
            }),
          ])
        } catch {
          resolved = null
        } finally {
          if (lookupTimeout) clearTimeout(lookupTimeout)
        }
      }

      if (cancelled) return
      setAccountReturn(resolved)
      setResolving(false)
      if (!resolved) return

      window.sessionStorage.removeItem(PAYMENT_RETURN_KEY)
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: 'drapeon:payment-return', orderId: resolved.orderId, reference, checkoutId, status },
          window.location.origin
        )
        window.close()
        return
      }
      router.replace(resolved.returnTo)
    }
    void resolveReturn()
    return () => { cancelled = true }
  }, [checkoutId, reference, router, status])

  if (resolving || accountReturn) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Payment status</p>
        <h1 className="font-display text-3xl text-ink">Returning to your order</h1>
        <p className="text-sm leading-6 text-ink/60">We are reopening your order so Drapeon can show its confirmed payment status.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Payment return</p>
      <h1 className="font-display text-3xl text-ink">Continue securely</h1>
      <p className="text-sm leading-6 text-ink/60">Sign in to review the order receipt, or return to the Drapeon app if you started there.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/sign-in" className="rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">Sign in</Link>
        <a href={appUrl} className="rounded-full border border-ink/14 bg-white px-5 py-3 text-sm font-semibold text-ink">Open app</a>
      </div>
      {reference || checkoutId ? <p className="text-xs text-ink/45">Reference: {reference ?? checkoutId}</p> : null}
    </main>
  )
}
