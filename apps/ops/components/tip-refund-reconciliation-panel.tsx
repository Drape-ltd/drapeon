'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { confirmedMoneyPreparation } from '../lib/money-action-response.mjs'

export function TipRefundReconciliationPanel({ canPrepare, grantExpiresAt }: {
  canPrepare: boolean; grantExpiresAt: string | null
}) {
  const router = useRouter()
  const [tipId, setTipId] = useState('')
  const [providerRefundId, setProviderRefundId] = useState('')
  const [orderReference, setOrderReference] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [reason, setReason] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; requestId?: string } | null>(null)
  const amountMinor = Number(amount)
  const ready = canPrepare && Boolean(grantExpiresAt) && reviewed && !pending &&
    tipId.trim().length > 0 && /^re_[A-Za-z0-9]+$/u.test(providerRefundId.trim()) &&
    /^DRP[A-Z0-9]+$/u.test(orderReference.trim().toUpperCase()) &&
    Number.isSafeInteger(amountMinor) && amountMinor > 0 &&
    /^[A-Z]{3}$/u.test(currency.trim().toUpperCase()) && reason.trim().length >= 12

  async function prepare() {
    if (!ready) return
    setPending(true)
    setResult(null)
    try {
      const response = await fetch('/ops/api/actions/money', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
        body: JSON.stringify({ action: 'PREPARE', recoveryKind: 'TIP_REFUND_RECONCILIATION',
          tipId: tipId.trim(), providerRefundId: providerRefundId.trim(),
          expectedOrderReference: orderReference.trim().toUpperCase(),
          expectedAmount: amountMinor, expectedCurrency: currency.trim().toUpperCase(), reason: reason.trim() }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        setResult({ ok: false, message: String(body.error ?? 'The review could not be prepared.') })
        return
      }
      const prepared = confirmedMoneyPreparation(body, response.status)
      if (!prepared || prepared.state !== 'PENDING_APPROVAL') {
        setResult({ ok: false, message: 'Reload Money Desk to confirm the current request state.' })
        router.refresh()
        return
      }
      const data = body.result && typeof body.result === 'object' ? body.result as Record<string, unknown> : {}
      setResult({ ok: true, message: 'Prepared for two independent approvals. No refund was sent; payment and ledger records are unchanged.',
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined })
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The response was interrupted. Reload before trying again.' })
    } finally {
      setPending(false)
    }
  }

  return <details className="ops-section-block" id="tip-refund-reconciliation">
    <summary>Reconcile an external Dev tip refund</summary>
    <div className="ops-panel-body" style={{ display: 'grid', gap: 14 }}>
      <p>Use only after Stripe TEST has already refunded this exact tip. This prepares a two-person review; it cannot send another refund. The old failed request stays in the audit trail.</p>
      <label className="ops-field">Tip ID<input value={tipId} onChange={(event) => setTipId(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Stripe TEST refund ID<input value={providerRefundId} onChange={(event) => setProviderRefundId(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Order reference<input value={orderReference} onChange={(event) => setOrderReference(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Exact tip amount, minor units<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Currency<input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Review reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="ops-check-row"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I matched the existing Stripe TEST refund to this tip, amount, order and old failed review.</span></label>
      {!grantExpiresAt ? <p>Fresh MFA and Money Desk elevation are required.</p> : null}
      <button className="ops-button ops-button-primary" type="button" disabled={!ready} onClick={prepare}>{pending ? 'Preparing…' : 'Prepare two-person review'}</button>
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.message}{result.requestId ? <a href={`/ops/money#money-${result.requestId}`}>Open request</a> : null}</div> : null}
    </div>
  </details>
}
