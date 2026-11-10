'use client'

import { CheckCircle2, Clock3, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { PayoutClaimRetryCandidate } from '@drape/shared/payout-claim-retry-preparation'
import { formatRelativeTime } from '../lib/work-items'

type Result = { ok: boolean; message: string; correlationId?: string; requestId?: string; reference?: string }

function amount(value: number, currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value / 100) }
  catch { return `${currency} ${(value / 100).toFixed(2)}` }
}

export function ClaimedPayoutRetryPreparationPanel({ candidates, canPrepare }: { candidates: PayoutClaimRetryCandidate[]; canPrepare: boolean }) {
  const router = useRouter()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, Result>>({})

  async function prepare(candidate: PayoutClaimRetryCandidate) {
    const reason = (reasons[candidate.claimId] ?? '').trim()
    if (!canPrepare || !reviewed[candidate.claimId] || reason.length < 12 || pending) return
    setPending(candidate.claimId)
    setResults((current) => ({ ...current, [candidate.claimId]: { ok: false, message: 'Preparing the reviewed request…' } }))
    const correlationId = crypto.randomUUID()
    try {
      const response = await fetch('/ops/api/actions/money', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({ action: 'PREPARE', retryClaimId: candidate.claimId, reason }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      const result = body.result && typeof body.result === 'object' ? body.result as Record<string, unknown> : {}
      const requestId = typeof result.requestId === 'string' ? result.requestId : null
      const reference = typeof result.reference === 'string' ? result.reference : null
      const responseCorrelationId = typeof body.correlationId === 'string' ? body.correlationId : correlationId
      if (!response.ok || body.ok !== true || !requestId || !reference || result.status !== 'PENDING_APPROVAL') {
        const code = typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : 'REQUEST_PREPARATION_FAILED'
        setResults((current) => ({ ...current, [candidate.claimId]: { ok: false, message: retryErrorMessage(code), correlationId: responseCorrelationId } }))
        router.refresh()
        return
      }
      setResults((current) => ({ ...current, [candidate.claimId]: { ok: true, message: `Two-person review prepared: ${reference}. No payout was sent.`, correlationId: responseCorrelationId, requestId, reference } }))
      setReasons((current) => ({ ...current, [candidate.claimId]: '' }))
      router.refresh()
    } catch {
      setResults((current) => ({ ...current, [candidate.claimId]: { ok: false, message: 'The preparation response was interrupted. Reload the Money Desk to check whether the review already exists.', correlationId } }))
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  if (candidates.length === 0) return null
  return (
    <section className="ops-section-block" id="claimed-payout-retries">
      <div className="ops-section-head"><div><p className="ops-action-label">Reviewed recovery preparation</p><h2>Definite not-sent payout retries</h2></div><span className="ops-muted">{candidates.length} candidate{candidates.length === 1 ? '' : 's'}</span></div>
      <p className="ops-muted">This screen only prepares a two-person Money Desk review. It does not approve the request or send a payout. The retry still rechecks the claim, destination, source charge, provider evidence, and ten-minute grace at execution.</p>
      <div className="ops-domain-list">
        {candidates.map((candidate) => {
          const reason = reasons[candidate.claimId] ?? ''
          const result = results[candidate.claimId]
          const busy = pending === candidate.claimId
          return (
            <article className="ops-domain-row ops-claim-retry-row" key={candidate.claimId}>
              <span className="ops-provider-icon" data-tone={candidate.request ? 'warning' : candidate.graceElapsed ? 'healthy' : 'neutral'}>{candidate.graceElapsed ? <ShieldCheck size={16} /> : <Clock3 size={16} />}</span>
              <div><strong>{candidate.orderReference ?? 'Order under review'}</strong><small>{amount(candidate.amount, candidate.currency)} · same Stripe destination</small></div>
              <div><span className="ops-label">Not-sent confirmation</span><strong>{formatRelativeTime(candidate.confirmedAt)}</strong><small>{candidate.graceElapsed ? 'Ten-minute grace elapsed' : `Review available ${formatRelativeTime(candidate.availableAt)}`}</small></div>
              <div className="ops-retry-preparation-detail ops-claim-retry-detail">
                {candidate.request ? <><span className="ops-label">Existing review</span><strong>{candidate.request.reference} · {candidate.request.status.replaceAll('_', ' ')}</strong><small>Open the existing request; this target cannot have another active review.</small><a className="ops-button" href={`/ops/money?view=${candidate.request.status === 'PENDING_APPROVAL' ? 'approval' : 'execution'}#money-${candidate.request.id}`}>Open review</a></> : !candidate.graceElapsed ? <><span className="ops-label">Retry hold</span><strong>Ten-minute grace is active</strong><small>Available {new Date(candidate.availableAt).toLocaleString()}</small></> : <>
                  <span className="ops-label">Prepare a new review</span>
                  <small>Requesting this review does not reserve or send money. Two independent approvals are required before a retry can run.</small>
                  <label className="ops-field">Evidence reviewed<textarea maxLength={1000} value={reason} onChange={(event) => setReasons((current) => ({ ...current, [candidate.claimId]: event.target.value }))} placeholder="Summarize the confirmed not-sent evidence and why a same-destination retry is appropriate." /></label>
                  <label className="ops-check-row"><input type="checkbox" checked={reviewed[candidate.claimId] === true} onChange={(event) => setReviewed((current) => ({ ...current, [candidate.claimId]: event.target.checked }))} /><span>I verified the failed payout, exact destination, original charge, not-sent confirmation, and retry evidence.</span></label>
                  <button className="ops-button ops-button-primary" type="button" disabled={!canPrepare || !reviewed[candidate.claimId] || reason.trim().length < 12 || busy || pending !== null} onClick={() => prepare(candidate)}>{busy ? <LoaderCircle className="ops-spin" size={14} /> : <ShieldCheck size={14} />}Prepare two-person review</button>
                </>}
                {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.ok ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}<span>{result.message}{result.requestId ? <small><a href={`/ops/money?view=approval#money-${result.requestId}`}>Open prepared Money Desk request</a></small> : null}{result.correlationId ? <small>Correlation {result.correlationId}</small> : null}</span></div> : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function retryErrorMessage(code: string) {
  switch (code) {
    case 'RETRY_GRACE_ACTIVE': return 'The ten-minute provider-confirmation grace has not elapsed. Refresh this queue later.'
    case 'RETRY_ALREADY_AUTHORIZED': return 'This failed operation already has a reviewed retry authorization. Refresh the claim before preparing another.'
    case 'CLAIM_NOT_RETRYABLE': return 'This payout claim is no longer in a retryable state. Refresh and review its latest evidence.'
    case 'RETRY_EVIDENCE_MISMATCH': return 'The payout, destination, tranche, or provider evidence no longer matches. No request was prepared.'
    case 'RETRY_DATA_UNAVAILABLE': return 'The authoritative retry evidence could not be loaded. No request was prepared.'
    case 'INVALID_REASON': return 'Add an evidence-based reason of at least 12 characters.'
    case 'ACTIVE_REQUEST_EXISTS': return 'An active review already exists for this payout. Open that request instead.'
    case 'REQUEST_SUBMISSION_FAILED': return 'The review could not be prepared. Refresh the Money Desk before retrying.'
    default: return code
  }
}
