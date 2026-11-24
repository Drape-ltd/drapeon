'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { confirmedMoneyPreparation } from '../lib/money-action-response.mjs'

export function BachsRefundRecoveryPanel({ canPrepare, protectedAccess, grantExpiresAt }: {
  canPrepare: boolean; protectedAccess: boolean; grantExpiresAt: string | null
}) {
  const router = useRouter()
  const [claimId, setClaimId] = useState('')
  const [issueId, setIssueId] = useState('')
  const [orderReference, setOrderReference] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; requestId?: string } | null>(null)
  const amount = Number(refundAmount)
  const ready = canPrepare && protectedAccess && Boolean(grantExpiresAt) && confirmed && !pending &&
    claimId.trim().length > 0 && issueId.trim().length > 0 &&
    /^DRP[A-Z0-9]+$/u.test(orderReference.trim().toUpperCase()) &&
    Number.isSafeInteger(amount) && amount > 0 && reason.trim().length >= 12

  async function prepare() {
    if (!ready) return
    setPending(true)
    setResult(null)
    try {
      const response = await fetch('/ops/api/actions/money', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
        body: JSON.stringify({ action: 'PREPARE', recoveryKind: 'BACHS_REFUND_RECOVERY',
          claimId: claimId.trim(), issueId: issueId.trim(),
          expectedOrderReference: orderReference.trim().toUpperCase(),
          expectedAmount: amount, expectedCurrency: 'NGN', reason: reason.trim() }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        setResult({ ok: false, message: String(body.error ?? 'The recovery review could not be prepared.') })
        return
      }
      const prepared = confirmedMoneyPreparation(body, response.status)
      if (!prepared || prepared.state !== 'PENDING_APPROVAL') {
        setResult({ ok: false, message: 'Reload Money Desk to confirm the current request state.' })
        router.refresh()
        return
      }
      const data = body.result && typeof body.result === 'object' ? body.result as Record<string, unknown> : {}
      const notification = body.notification && typeof body.notification === 'object' ? body.notification as Record<string, unknown> : {}
      setResult({ ok: true,
        message: notification.email === 'sent' || notification.slack === 'queued'
          ? 'Prepared for two independent approvals. No transfer or customer refund has been sent.'
          : 'Prepared for two approvals; an approval notice needs attention. No transfer or customer refund has been sent.',
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined })
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The response was interrupted. Reload before retrying.' })
    } finally {
      setPending(false)
    }
  }

  return <details className="ops-section-block" id="bachs-refund-recovery">
    <summary>Prepare a Dev Bachs refund-balance recovery</summary>
    <div className="ops-panel-body" style={{ display: 'grid', gap: 14 }}>
      <p>Use only for a Bachs refund claim with an exact 400 no-movement balance refusal. The amount is derived from that claim’s frozen tailor allocation and a matching confirmed transfer. Two independent approvals are required. Execution checks the connected account’s available balance; pending funds do not count. This only transfers money back to Drapeon. After the transfer is confirmed paid, submit the customer refund through the normal reviewed refund-claim path.</p>
      <label className="ops-field">Failed refund claim ID<input value={claimId} onChange={(event) => setClaimId(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Open Bachs refund Ops case ID<input value={issueId} onChange={(event) => setIssueId(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Order reference<input value={orderReference} onChange={(event) => setOrderReference(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Exact customer refund amount, minor units<input inputMode="numeric" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} autoComplete="off" /></label>
      <label className="ops-field">Review reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="ops-check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I verified the no-movement provider evidence, linked transfer, pinned recipient account and exact refund. If this transfer is pending, wait for reconciliation before submitting the customer refund through its normal reviewed claim.</span></label>
      {!protectedAccess || !grantExpiresAt ? <p>Fresh MFA and a Dev Money Desk elevation are required before preparation.</p> : null}
      <button className="ops-button ops-button-primary" type="button" disabled={!ready} onClick={prepare}>{pending ? 'Preparing…' : 'Prepare two-person review'}</button>
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.message}{result.requestId ? <a href={`/ops/money#money-${result.requestId}`}>Open request</a> : null}</div> : null}
    </div>
  </details>
}
