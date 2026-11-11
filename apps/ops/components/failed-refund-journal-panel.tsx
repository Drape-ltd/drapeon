'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { confirmedMoneyPreparation } from '../lib/money-action-response.mjs'

export function FailedRefundJournalPanel({ canPrepare, protectedAccess, grantExpiresAt }: {
  canPrepare: boolean
  protectedAccess: boolean
  grantExpiresAt: string | null
}) {
  const router = useRouter()
  const [refundId, setRefundId] = useState('')
  const [issueId, setIssueId] = useState('')
  const [orderReference, setOrderReference] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [reason, setReason] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; requestId?: string } | null>(null)
  const amountMinor = Number(amount)
  const ready = canPrepare && protectedAccess && Boolean(grantExpiresAt) && reviewed &&
    refundId.trim().length > 0 && issueId.trim().length > 0 &&
    /^DRP[A-Z0-9]+$/u.test(orderReference.trim().toUpperCase()) &&
    Number.isSafeInteger(amountMinor) && amountMinor > 0 &&
    /^[A-Z]{3}$/u.test(currency.trim().toUpperCase()) && reason.trim().length >= 12 && !pending

  async function prepare() {
    if (!ready) return
    setPending(true)
    setResult(null)
    try {
      const response = await fetch('/ops/api/actions/money', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
        body: JSON.stringify({ action: 'PREPARE', recoveryKind: 'FAILED_REFUND_JOURNAL',
          failedRefundId: refundId.trim(), issueId: issueId.trim(),
          expectedOrderReference: orderReference.trim().toUpperCase(),
          expectedAmount: amountMinor, expectedCurrency: currency.trim().toUpperCase(),
          reason: reason.trim() }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        setResult({ ok: false, message: String(body.error ?? 'The recovery request could not be prepared.') })
        return
      }
      const prepared = confirmedMoneyPreparation(body, response.status)
      if (!prepared || prepared.state !== 'PENDING_APPROVAL') {
        setResult({ ok: false, message: 'The request state could not be confirmed. Reload Money Desk before retrying.' })
        router.refresh()
        return
      }
      const data = body.result && typeof body.result === 'object' ? body.result as Record<string, unknown> : {}
      const notification = body.notification && typeof body.notification === 'object' ? body.notification as Record<string, unknown> : {}
      setResult({ ok: true,
        message: notification.email === 'sent' && ['queued', 'already-queued'].includes(String(notification.slack))
          ? 'Prepared for two independent approvals. No ledger entry was changed.'
          : 'Prepared for two approvals; at least one Ops notice needs attention. No ledger entry was changed.',
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined })
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The response was interrupted. Reload before trying again.' })
    } finally {
      setPending(false)
    }
  }

  return <details className="ops-section-block" id="failed-refund-journal-recovery">
    <summary>Prepare reviewed failed-refund journal recovery</summary>
    <div className="ops-panel-body" style={{ display: 'grid', gap: 14 }}>
      <p>Use only when Stripe confirms the refund failed but the commercial ledger still has its refund journal. Preparing this request does not retry a refund or alter the ledger. Two other Money Desk principals must approve the exact amount before execution.</p>
      <label className="ops-field">Failed provider-refund row ID<input value={refundId} onChange={(event) => setRefundId(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Open ledger-mismatch Ops case ID<input value={issueId} onChange={(event) => setIssueId(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Order reference<input value={orderReference} onChange={(event) => setOrderReference(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Exact failed refund amount, minor units<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Currency<input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Review reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="ops-check-row"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I checked the failed provider refund, the exact unreversed journal, and the open Ops case against this order and amount.</span></label>
      {!protectedAccess || !grantExpiresAt ? <p>Fresh MFA and a Money Desk elevation are required before preparation.</p> : null}
      <button className="ops-button ops-button-primary" type="button" disabled={!ready} onClick={prepare}>{pending ? 'Preparing…' : 'Prepare two-person review'}</button>
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.message}{result.requestId ? <a href={`/ops/money#money-${result.requestId}`}>Open request</a> : null}</div> : null}
    </div>
  </details>
}
